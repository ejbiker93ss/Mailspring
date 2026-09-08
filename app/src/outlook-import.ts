export interface OutlookAccount {
  emailAddress: string;
  name: string;
  kind: 'imap' | 'exchange' | 'pop' | 'unknown';
  settings: Record<string, string | number>;
}

const text = (value: unknown) =>
  typeof value === 'string'
    ? value
        // Registry strings can contain terminators and other control characters.
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f]/g, '')
        .trim()
        .slice(0, 320)
    : '';

// Both discovered and persisted data cross this allowlist. Secrets are never saved.
export function normalizeOutlookAccounts(rows: unknown): OutlookAccount[] {
  if (!Array.isArray(rows)) return [];
  const accounts = new Map<string, OutlookAccount>();
  for (const row of rows.slice(0, 500)) {
    if (!row || typeof row !== 'object') continue;
    const emailAddress = text(row.emailAddress).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAddress)) continue;
    const source = row.settings || row;
    const settings: OutlookAccount['settings'] = {};
    for (const key of ['imap_host', 'smtp_host', 'imap_username', 'smtp_username']) {
      const value = text(source[key]);
      if (value) settings[key] = value;
    }
    for (const key of ['imap_port', 'smtp_port']) {
      const value = Number(source[key]);
      if (Number.isInteger(value) && value > 0 && value <= 65535) settings[key] = value;
    }
    const kind = ['imap', 'exchange', 'pop'].includes(row.kind) ? row.kind : 'unknown';
    const previous = accounts.get(emailAddress);
    accounts.set(emailAddress, {
      emailAddress,
      name: text(row.name) || previous?.name || emailAddress,
      kind: kind === 'unknown' ? previous?.kind || kind : kind,
      settings: { ...previous?.settings, ...settings },
    });
  }
  return [...accounts.values()];
}

export function outlookAccountSetup(
  account: OutlookAccount,
  provider: string
): {
  name: string;
  emailAddress: string;
  provider: string;
  settings: Record<string, string | number>;
} {
  const domain = account.emailAddress.split('@')[1];
  return {
    name: account.name,
    emailAddress: account.emailAddress,
    provider,
    settings:
      provider === 'imap'
        ? {
            imap_host: `imap.${domain}`,
            smtp_host: `smtp.${domain}`,
            imap_username: account.emailAddress,
            smtp_username: account.emailAddress,
            imap_port: 993,
            smtp_port: 587,
            ...account.settings,
            imap_security: account.settings.imap_port === 143 ? 'STARTTLS' : 'SSL / TLS',
            smtp_security: account.settings.smtp_port === 465 ? 'SSL / TLS' : 'STARTTLS',
          }
        : provider === 'smartermail'
          ? { smartermail_server: `https://mail.${domain}` }
          : {},
  };
}

export function outlookAccountProvider(account: OutlookAccount) {
  const domain = account.emailAddress.split('@')[1];
  if (domain === 'gmail.com' || account.settings.imap_host === 'imap.gmail.com') return 'gmail';
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain)) return 'outlook';
  if (account.kind === 'exchange') return 'office365';
  return 'imap';
}
