import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import childProcess from 'child_process';
import { dialog, safeStorage } from 'electron';

const REQUIRED_PROFILE_FILES = ['config.json', 'edgehill.db'];
const SQLITE_SIDECARS = ['edgehill.db-wal', 'edgehill.db-shm'];
const DECLINED_MARKER = '.mailspring-profile-migration-declined';
const COMPLETED_MARKER = '.mailspring-profile-migration-complete';
const ATTACHMENTS_COMPLETED_MARKER = '.mailspring-attachment-migration-complete';

const readConfig = (configPath: string) => {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    return null;
  }
};

const accountEmails = (configPath: string) => {
  const settings = readConfig(configPath)?.['*'];
  return new Set<string>(
    (Array.isArray(settings?.accounts) ? settings.accounts : [])
      .map((account) => `${account.emailAddress || ''}`.toLowerCase())
      .filter(Boolean)
  );
};

export const decryptChromiumV10CredentialBlob = (encrypted: Buffer, key: Buffer) => {
  if (encrypted.subarray(0, 3).toString('ascii') !== 'v10' || encrypted.length < 32) {
    throw new Error('The Mailspring credential data uses an unsupported encryption format.');
  }
  const nonce = encrypted.subarray(3, 15);
  const ciphertext = encrypted.subarray(15, -16);
  const authTag = encrypted.subarray(-16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};

const unprotectWindowsKey = (encryptedKey: Buffer) => {
  const script = [
    'Add-Type -AssemblyName System.Security',
    '$inputValue = [Console]::In.ReadToEnd()',
    '$encrypted = [Convert]::FromBase64String($inputValue)',
    '$plain = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Convert]::ToBase64String($plain))',
  ].join('; ');
  const result = childProcess.spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      input: encryptedKey.toString('base64'),
      encoding: 'utf8',
      windowsHide: true,
    }
  );
  if (result.status !== 0 || !result.stdout) {
    throw new Error('Windows could not unlock the Mailspring credential key for this user.');
  }
  return Buffer.from(result.stdout.trim(), 'base64');
};

const deserializeBuffer = (value: any) => {
  if (Buffer.isBuffer(value)) return value;
  if (value?.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
  throw new Error('The Mailspring credential data is missing or invalid.');
};

const migrateAttachmentCache = (sourceProfile: string, destinationProfile: string) => {
  const sourceFiles = path.join(sourceProfile, 'files');
  if (fs.existsSync(sourceFiles)) {
    fs.cpSync(sourceFiles, path.join(destinationProfile, 'files'), {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  }
  fs.writeFileSync(path.join(destinationProfile, ATTACHMENTS_COMPLETED_MARKER), 'completed\n');
};

const reencryptLegacyCredentials = (sourceProfile: string, destinationProfile: string) => {
  if (process.platform !== 'win32') return;

  const sourceConfigPath = path.join(sourceProfile, 'config.json');
  const sourceConfig = readConfig(sourceConfigPath);
  const encryptedCredentials = deserializeBuffer(sourceConfig?.['*']?.credentials);
  const localState = readConfig(path.join(sourceProfile, 'Local State'));
  const protectedKey = Buffer.from(localState?.os_crypt?.encrypted_key || '', 'base64');
  if (protectedKey.subarray(0, 5).toString('ascii') !== 'DPAPI') {
    throw new Error('The Mailspring Windows credential key is missing or invalid.');
  }

  const key = unprotectWindowsKey(protectedKey.subarray(5));
  try {
    const plaintext = decryptChromiumV10CredentialBlob(encryptedCredentials, key);
    const credentials = JSON.parse(plaintext);
    const accounts = sourceConfig?.['*']?.accounts || [];
    const missing = accounts.filter((account) => {
      const email = account.emailAddress;
      return (
        !email ||
        (!credentials[`${email}-imap`] && !credentials[`${email}-refresh-token`]) ||
        (!credentials[`${email}-smtp`] && !credentials[`${email}-refresh-token`])
      );
    });
    if (missing.length > 0) {
      throw new Error(
        `Mailspring does not have complete saved credentials for ${missing.length} account(s).`
      );
    }

    const destinationConfigPath = path.join(destinationProfile, 'config.json');
    const destinationConfig = readConfig(destinationConfigPath);
    destinationConfig['*'].credentials = safeStorage.encryptString(plaintext);
    fs.writeFileSync(destinationConfigPath, JSON.stringify(destinationConfig, null, 2));
  } finally {
    key.fill(0);
  }
};

export const shouldOfferMailspringProfileMigration = (
  sourceProfile: string,
  destinationProfile: string
) => {
  if (fs.existsSync(path.join(destinationProfile, DECLINED_MARKER))) {
    return false;
  }
  if (fs.existsSync(path.join(destinationProfile, COMPLETED_MARKER))) {
    return false;
  }
  if (!REQUIRED_PROFILE_FILES.every((name) => fs.existsSync(path.join(sourceProfile, name)))) {
    return false;
  }
  const sourceConfigPath = path.join(sourceProfile, 'config.json');
  const sourceConfig = readConfig(sourceConfigPath);
  if (sourceConfig && accountEmails(sourceConfigPath).size === 0) {
    return false;
  }
  // A running Mailspring instance can hold config.json with exclusive access.
  // Still offer migration so accepting it produces the actionable close-and-retry error.
  if (!sourceConfig) {
    return true;
  }
  const sourceEmails = accountEmails(sourceConfigPath);
  const destinationEmails = accountEmails(path.join(destinationProfile, 'config.json'));
  return (
    destinationEmails.size === 0 || [...sourceEmails].some((email) => destinationEmails.has(email))
  );
};

export const migrateMailspringProfile = (
  sourceProfile: string,
  destinationProfile: string,
  { migrateCredentials = process.platform === 'win32' } = {}
) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupProfile = path.join(destinationProfile, `migration-backup-${timestamp}`);
  const filesToCopy = REQUIRED_PROFILE_FILES.concat(
    SQLITE_SIDECARS.filter((name) => fs.existsSync(path.join(sourceProfile, name)))
  );
  const destinationFilesThatExisted = new Set<string>();

  fs.mkdirSync(destinationProfile, { recursive: true });
  fs.mkdirSync(backupProfile, { recursive: true });

  for (const name of REQUIRED_PROFILE_FILES.concat(SQLITE_SIDECARS)) {
    const destination = path.join(destinationProfile, name);
    if (fs.existsSync(destination)) {
      destinationFilesThatExisted.add(name);
      fs.copyFileSync(destination, path.join(backupProfile, name));
    }
  }

  try {
    for (const name of filesToCopy) {
      fs.copyFileSync(path.join(sourceProfile, name), path.join(destinationProfile, name));
    }
    for (const name of SQLITE_SIDECARS) {
      if (!filesToCopy.includes(name)) {
        fs.rmSync(path.join(destinationProfile, name), { force: true });
      }
    }
    if (migrateCredentials) {
      reencryptLegacyCredentials(sourceProfile, destinationProfile);
    }
    migrateAttachmentCache(sourceProfile, destinationProfile);
    fs.writeFileSync(path.join(destinationProfile, COMPLETED_MARKER), 'completed\n');
  } catch (error) {
    for (const name of REQUIRED_PROFILE_FILES.concat(SQLITE_SIDECARS)) {
      const backup = path.join(backupProfile, name);
      if (fs.existsSync(backup)) {
        fs.copyFileSync(backup, path.join(destinationProfile, name));
      } else if (!destinationFilesThatExisted.has(name)) {
        fs.rmSync(path.join(destinationProfile, name), { force: true });
      }
    }
    throw error;
  }

  return backupProfile;
};

export const maybeMigrateMailspringProfile = (destinationProfile: string) => {
  if (path.basename(destinationProfile).toLowerCase() !== 'summermail') {
    return false;
  }
  const sourceProfile = path.join(path.dirname(destinationProfile), 'Mailspring');
  if (
    fs.existsSync(path.join(destinationProfile, COMPLETED_MARKER)) &&
    !fs.existsSync(path.join(destinationProfile, ATTACHMENTS_COMPLETED_MARKER))
  ) {
    try {
      migrateAttachmentCache(sourceProfile, destinationProfile);
    } catch (error) {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Attachment migration was not completed',
        message: 'SummerMail could not copy your cached Mailspring attachments.',
        detail: `${error.message}\n\nClose Mailspring and restart SummerMail to try again.`,
        buttons: ['OK'],
      });
    }
  }
  if (!shouldOfferMailspringProfileMigration(sourceProfile, destinationProfile)) {
    return false;
  }

  const choice = dialog.showMessageBoxSync({
    type: 'question',
    title: 'Bring your accounts to SummerMail?',
    message: 'SummerMail found your existing Mailspring accounts.',
    detail:
      'Migrate your account settings, saved credentials, and local mail database so you can continue without signing in again. Your Mailspring profile will remain unchanged.',
    buttons: ['Migrate Accounts', 'Start Fresh'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });

  if (choice !== 0) {
    fs.writeFileSync(path.join(destinationProfile, DECLINED_MARKER), 'declined\n');
    return false;
  }

  try {
    migrateMailspringProfile(sourceProfile, destinationProfile);
    return true;
  } catch (error) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Account migration was not completed',
      message: 'SummerMail could not copy your Mailspring accounts.',
      detail: `${error.message}\n\nClose Mailspring and restart SummerMail to try again.`,
      buttons: ['OK'],
    });
    return false;
  }
};
