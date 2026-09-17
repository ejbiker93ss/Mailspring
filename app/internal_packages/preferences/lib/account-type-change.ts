import { Account, IdentityStore, KeyManager, localized } from 'summermail-exports';
import { MailsyncProcess } from '../../../src/mailsync-process';
import { normalizeSmarterMailServerURL } from '../../onboarding/lib/onboarding-helpers';

export type ConvertibleAccountType = 'imap' | 'smartermail';

export function buildAccountTypeChange(
  account: Account,
  provider: ConvertibleAccountType,
  serverURL: string
) {
  if (
    !['imap', 'smartermail'].includes(account.provider) ||
    !['imap', 'smartermail'].includes(provider)
  ) {
    throw new Error(localized('This account type requires a separate sign-in.'));
  }
  const candidate = account.clone();
  candidate.provider = provider;
  candidate.settings = { ...account.settings };
  if (provider === 'smartermail') {
    const origin = normalizeSmarterMailServerURL(serverURL);
    candidate.settings.smartermail_server = origin;
    delete candidate.settings.caldav_host;
    delete candidate.settings.carddav_host;
    delete candidate.settings.caldav_username;
    delete candidate.settings.caldav_password;
  } else {
    delete candidate.settings.smartermail_server;
  }
  // Keep the account ID, IMAP/SMTP endpoints, folder prefix and all user metadata.
  // Recomputing the ID or replacing mail hosts here would orphan cached mail.
  return candidate;
}

export async function verifyAccountTypeChange(
  account: Account,
  provider: ConvertibleAccountType,
  serverURL: string
) {
  const candidate = buildAccountTypeChange(account, provider, serverURL);
  const withSecrets = await KeyManager.insertAccountSecrets(candidate);
  if (!withSecrets.settings.imap_password || !withSecrets.settings.smtp_password) {
    throw new Error(
      localized('Update the account connection settings to save a mail password first.')
    );
  }
  const process = new MailsyncProcess(AppEnv.getLoadSettings());
  process.identity = IdentityStore.identity();
  process.account = withSecrets;
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([
      process.test(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                localized('Mail verification timed out. Check your connection and try again.')
              )
            ),
          45000
        );
      }),
    ]);
    clearTimeout(timer);
  } finally {
    clearTimeout(timer);
    process.kill();
  }
  candidate.authedAt = new Date();
  return candidate;
}
