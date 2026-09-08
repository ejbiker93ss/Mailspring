export function emailDomain(email: string) {
  const match = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/.exec(email.trim());
  return match ? match[1].toLowerCase() : '';
}

export function imapCalendarDefaults(account: {
  emailAddress: string;
  settings: Record<string, any>;
}) {
  const { settings, emailAddress } = account;
  const domain = emailDomain(emailAddress);
  return {
    caldav_host: settings.caldav_host || (domain ? `https://mail.${domain}/WebDAV/` : ''),
    caldav_username: settings.caldav_username || settings.imap_username || emailAddress,
    caldav_password: settings.caldav_password || settings.imap_password || '',
  };
}
