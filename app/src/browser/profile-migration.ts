import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import childProcess from 'child_process';
import { BrowserWindow, dialog, safeStorage } from 'electron';

const REQUIRED_PROFILE_FILES = ['config.json', 'edgehill.db'];
const SQLITE_SIDECARS = ['edgehill.db-wal', 'edgehill.db-shm'];
const DECLINED_MARKER = '.mailspring-profile-migration-declined';
const COMPLETED_MARKER = '.mailspring-profile-migration-complete';
const ATTACHMENTS_COMPLETED_MARKER = '.mailspring-attachment-migration-complete';

type MigrationProgress = (percent: number, status: string) => void;
type MigrationOptions = {
  migrateCredentials?: boolean;
  onProgress?: MigrationProgress;
};

const migrationWindowMarkup = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="dark">
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        color: #f8fafc;
        background:
          radial-gradient(circle at 82% 12%, rgba(96, 165, 250, 0.22), transparent 42%),
          linear-gradient(145deg, #172033 0%, #0b1220 72%);
        font-family: "Segoe UI", system-ui, sans-serif;
        user-select: none;
      }
      main { width: 100%; padding: 30px 34px 28px; }
      .brand { display: flex; align-items: center; gap: 14px; }
      .mark {
        display: grid;
        width: 42px;
        height: 42px;
        place-items: center;
        border-radius: 13px;
        color: #082f49;
        background: linear-gradient(145deg, #7dd3fc, #60a5fa);
        box-shadow: 0 10px 28px rgba(59, 130, 246, 0.28);
        font-size: 22px;
        font-weight: 700;
      }
      h1 { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: -0.02em; }
      .detail { margin: 4px 0 0; color: #aebbd0; font-size: 13px; }
      .status { margin: 25px 0 9px; min-height: 18px; color: #dbeafe; font-size: 13px; }
      .track {
        height: 7px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.18);
      }
      .bar {
        position: relative;
        width: 8%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #38bdf8, #818cf8);
        transition: width 220ms ease;
      }
      .bar::after {
        content: "";
        position: absolute;
        inset: 0;
        width: 45%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,.65), transparent);
        animation: shimmer 1.25s ease-in-out infinite;
      }
      .footnote { margin-top: 12px; color: #718198; font-size: 11px; }
      @keyframes shimmer { from { transform: translateX(-140%); } to { transform: translateX(320%); } }
    </style>
  </head>
  <body>
    <main aria-live="polite">
      <div class="brand">
        <div class="mark" aria-hidden="true">S</div>
        <div>
          <h1>Setting up SummerMail</h1>
          <p class="detail">Bringing your existing accounts and mail to this app.</p>
        </div>
      </div>
      <div id="status" class="status">Preparing your account migration…</div>
      <div class="track" role="progressbar" aria-label="Migration progress" aria-valuemin="0" aria-valuemax="100">
        <div id="bar" class="bar"></div>
      </div>
      <div class="footnote">Keep SummerMail open. Your original Mailspring profile is not changed.</div>
    </main>
  </body>
</html>`;

const createMigrationWindow = async () => {
  const window = new BrowserWindow({
    width: 500,
    height: 218,
    center: true,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    backgroundColor: '#0b1220',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(migrationWindowMarkup)}`);
  window.show();
  window.focus();

  const update: MigrationProgress = (percent, status) => {
    if (window.isDestroyed()) return;
    const boundedPercent = Math.max(0, Math.min(100, percent));
    const script = `(() => {
      const bar = document.getElementById('bar');
      const status = document.getElementById('status');
      if (bar) bar.style.width = ${JSON.stringify(`${boundedPercent}%`)};
      if (status) status.textContent = ${JSON.stringify(status)};
    })()`;
    window.webContents.executeJavaScript(script).catch(() => {});
  };

  return { window, update };
};

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

const migrateAttachmentCache = async (sourceProfile: string, destinationProfile: string) => {
  const sourceFiles = path.join(sourceProfile, 'files');
  if (fs.existsSync(sourceFiles)) {
    await fs.promises.cp(sourceFiles, path.join(destinationProfile, 'files'), {
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

export const migrateMailspringProfile = async (
  sourceProfile: string,
  destinationProfile: string,
  {
    migrateCredentials = process.platform === 'win32',
    onProgress = () => {},
  }: MigrationOptions = {}
) => {
  onProgress(10, 'Preparing a safe backup…');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupProfile = path.join(destinationProfile, `migration-backup-${timestamp}`);
  const filesToCopy = REQUIRED_PROFILE_FILES.concat(
    SQLITE_SIDECARS.filter((name) => fs.existsSync(path.join(sourceProfile, name)))
  );
  const destinationFilesThatExisted = new Set<string>();

  fs.mkdirSync(destinationProfile, { recursive: true });
  fs.mkdirSync(backupProfile, { recursive: true });

  onProgress(24, 'Backing up your current SummerMail profile…');
  for (const name of REQUIRED_PROFILE_FILES.concat(SQLITE_SIDECARS)) {
    const destination = path.join(destinationProfile, name);
    if (fs.existsSync(destination)) {
      destinationFilesThatExisted.add(name);
      await fs.promises.copyFile(destination, path.join(backupProfile, name));
    }
  }

  try {
    onProgress(42, 'Copying account settings and the local mail database…');
    for (const name of filesToCopy) {
      await fs.promises.copyFile(
        path.join(sourceProfile, name),
        path.join(destinationProfile, name)
      );
    }
    for (const name of SQLITE_SIDECARS) {
      if (!filesToCopy.includes(name)) {
        fs.rmSync(path.join(destinationProfile, name), { force: true });
      }
    }
    if (migrateCredentials) {
      onProgress(62, 'Securing your saved account credentials…');
      reencryptLegacyCredentials(sourceProfile, destinationProfile);
    }
    onProgress(76, 'Copying cached attachments and inline images…');
    await migrateAttachmentCache(sourceProfile, destinationProfile);
    onProgress(96, 'Finishing your SummerMail profile…');
    fs.writeFileSync(path.join(destinationProfile, COMPLETED_MARKER), 'completed\n');
  } catch (error) {
    for (const name of REQUIRED_PROFILE_FILES.concat(SQLITE_SIDECARS)) {
      const backup = path.join(backupProfile, name);
      if (fs.existsSync(backup)) {
        await fs.promises.copyFile(backup, path.join(destinationProfile, name));
      } else if (!destinationFilesThatExisted.has(name)) {
        fs.rmSync(path.join(destinationProfile, name), { force: true });
      }
    }
    throw error;
  }

  return backupProfile;
};

export const maybeMigrateMailspringProfile = async (destinationProfile: string) => {
  if (path.basename(destinationProfile).toLowerCase() !== 'summermail') {
    return false;
  }
  const sourceProfile = path.join(path.dirname(destinationProfile), 'Mailspring');
  if (
    fs.existsSync(path.join(destinationProfile, COMPLETED_MARKER)) &&
    !fs.existsSync(path.join(destinationProfile, ATTACHMENTS_COMPLETED_MARKER))
  ) {
    try {
      await migrateAttachmentCache(sourceProfile, destinationProfile);
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

  let loadingWindow: Awaited<ReturnType<typeof createMigrationWindow>> | null = null;
  try {
    loadingWindow = await createMigrationWindow();
    await migrateMailspringProfile(sourceProfile, destinationProfile, {
      onProgress: loadingWindow.update,
    });
    loadingWindow.update(100, 'Account migration complete. Opening SummerMail…');
    await new Promise((resolve) => setTimeout(resolve, 350));
    return true;
  } catch (error) {
    if (loadingWindow?.window && !loadingWindow.window.isDestroyed()) {
      loadingWindow.window.close();
      loadingWindow = null;
    }
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Account migration was not completed',
      message: 'SummerMail could not copy your Mailspring accounts.',
      detail: `${error.message}\n\nClose Mailspring and restart SummerMail to try again.`,
      buttons: ['OK'],
    });
    return false;
  } finally {
    if (loadingWindow?.window && !loadingWindow.window.isDestroyed()) {
      loadingWindow.window.close();
    }
  }
};
