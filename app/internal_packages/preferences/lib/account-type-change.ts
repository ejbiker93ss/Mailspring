import https from 'https';
import { DOMParser } from '@xmldom/xmldom';
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
    candidate.settings.caldav_host = `${origin}/WebDAV/`;
    candidate.settings.carddav_host = `${origin}/WebDAV/`;
  } else {
    delete candidate.settings.smartermail_server;
  }
  // Keep the account ID, IMAP/SMTP endpoints, folder prefix and all user metadata.
  // Recomputing the ID or replacing mail hosts here would orphan cached mail.
  return candidate;
}

async function verifyDAV(account: Account) {
  const username = account.settings.caldav_username || account.settings.imap_username;
  const password = account.settings.caldav_password || account.settings.imap_password;
  const body =
    '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
  await new Promise<void>((resolve, reject) => {
    const request = https.request(
      account.settings.carddav_host,
      {
        method: 'PROPFIND',
        headers: {
          Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
          'Content-Type': 'application/xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          Depth: '0',
        },
      },
      (response) => {
        let text = '';
        response.on('error', () =>
          reject(new Error(localized('The server connection was interrupted. Try again.')))
        );
        response.on('data', (chunk) => {
          text += chunk;
          if (text.length > 1024 * 1024) request.destroy(new Error('Response too large'));
        });
        response.on('end', () => {
          if (response.statusCode === 401 || response.statusCode === 403) {
            reject(
              new Error(
                localized(
                  'The server rejected the saved DAV login. Check the calendar credentials and WebDAV access for this account.'
                )
              )
            );
            return;
          }
          try {
            const doc = new DOMParser({ errorHandler: () => {} }).parseFromString(
              text,
              'application/xml'
            );
            if (
              response.statusCode !== 207 ||
              !doc
                .getElementsByTagNameNS('DAV:', 'current-user-principal')[0]
                ?.getElementsByTagNameNS('DAV:', 'href')[0]
                ?.textContent?.trim()
            ) {
              throw new Error('No DAV principal');
            }
            resolve();
          } catch {
            reject(
              new Error(
                localized(
                  'This URL did not provide an authenticated DAV service. Check the SmarterMail server address.'
                )
              )
            );
          }
        });
      }
    );
    const timer = setTimeout(() => request.destroy(new Error('Timed out')), 15000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', () =>
      reject(
        new Error(
          localized(
            'Could not verify the SmarterMail server. Check the address, certificate and connection, then try again.'
          )
        )
      )
    );
    request.end(body);
  });
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
    if (provider === 'smartermail') await verifyDAV(withSecrets);
  } finally {
    clearTimeout(timer);
    process.kill();
  }
  candidate.authedAt = new Date();
  return candidate;
}
