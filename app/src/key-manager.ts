import { localized } from './intl';
import { Account } from 'summermail-exports';

interface KeySet {
  [key: string]: string;
}

const { safeStorage } = require('@electron/remote');

const configCredentialsKey = 'credentials';

// Keep the platform keychain behind a small, replaceable boundary so failures can be
// exercised without talking to the real OS credential store.
export const secureStorage = {
  isAvailable: (): Promise<boolean> => Promise.resolve(safeStorage.isEncryptionAvailable()),
  encrypt: (plaintext: string): Promise<Buffer> =>
    Promise.resolve(safeStorage.encryptString(plaintext)),
  decrypt: (encrypted: Buffer): Promise<string> =>
    Promise.resolve(safeStorage.decryptString(encrypted)),
};

/**
 * A basic wrap around electron's secure key management. Consolidates all of
 * our keys under a single namespaced keymap and provides migration
 * support.
 *
 * Consolidating this prevents a ton of key authorization popups for each
 * and every key we want to access.
 */
class KeyManager {
  private _fatalErrorReported = false;

  async deleteAccountSecrets(account: Account) {
    try {
      const keys = await this._getKeyHash();
      delete keys[`${account.emailAddress}-imap`];
      delete keys[`${account.emailAddress}-smtp`];
      delete keys[`${account.emailAddress}-caldav`];
      delete keys[`${account.emailAddress}-refresh-token`];
      await this._writeKeyHash(keys);
    } catch (err) {
      this._reportFatalError(err);
    }
  }

  async extractAndStoreAccountSecrets(account: Account) {
    try {
      const keys = await this._getKeyHash();
      keys[`${account.emailAddress}-imap`] = account.settings.imap_password;
      keys[`${account.emailAddress}-smtp`] = account.settings.smtp_password;
      if (account.settings.caldav_password) {
        keys[`${account.emailAddress}-caldav`] = account.settings.caldav_password;
      } else {
        delete keys[`${account.emailAddress}-caldav`];
      }
      keys[`${account.emailAddress}-refresh-token`] = account.settings.refresh_token;
      await this._writeKeyHash(keys);
    } catch (err) {
      this._reportFatalError(err);
    }
    const next = account.clone();
    delete next.settings.imap_password;
    delete next.settings.smtp_password;
    delete next.settings.caldav_password;
    delete next.settings.refresh_token;
    return next;
  }

  async insertAccountSecrets(account: Account, keys: KeySet = null) {
    const next = account.clone();
    if (!keys) keys = await this._getKeyHash();
    next.settings.imap_password = keys[`${account.emailAddress}-imap`];
    next.settings.smtp_password = keys[`${account.emailAddress}-smtp`];
    next.settings.caldav_password = keys[`${account.emailAddress}-caldav`];
    next.settings.refresh_token = keys[`${account.emailAddress}-refresh-token`];
    return next;
  }

  async replacePassword(keyName: string, newVal: string) {
    try {
      const keys = await this._getKeyHash();
      keys[keyName] = newVal;
      await this._writeKeyHash(keys);
    } catch (err) {
      this._reportFatalError(err);
    }
  }

  async deletePassword(keyName: string) {
    try {
      const keys = await this._getKeyHash();
      delete keys[keyName];
      await this._writeKeyHash(keys);
    } catch (err) {
      this._reportFatalError(err);
    }
  }

  async getPassword(keyName: string) {
    try {
      const keys = await this._getKeyHash();
      return keys[keyName];
    } catch (err) {
      this._reportFatalError(err);
    }
  }

  async _getKeyHash(): Promise<KeySet> {
    const encryptedCredentials = AppEnv.config.get(configCredentialsKey);
    // Check for different null values to prevent issues if a migration from keytar has failed
    if (
      encryptedCredentials === undefined ||
      encryptedCredentials === null ||
      encryptedCredentials === 'null'
    ) {
      return {} as KeySet;
    }

    let raw: string;
    try {
      raw = await secureStorage.decrypt(Buffer.from(encryptedCredentials, 'utf-8'));
    } catch (err) {
      // Treat an unreadable credential blob as fatal. Returning an empty object here lets the
      // next password update overwrite every saved account secret while the keyring is locked.
      this._reportFatalError(
        new Error(
          localized('SummerMail could not read your saved passwords and cannot continue.') +
            this._encryptionUnavailableHint()
        )
      );
    }

    try {
      return JSON.parse(raw) as KeySet;
    } catch (err) {
      return {} as KeySet;
    }
  }

  _encryptionUnavailableHint() {
    return process.platform === 'linux'
      ? localized(
          ' On Linux, SummerMail requires a secret service such as GNOME Keyring or KWallet. Please ensure one is installed and running, then restart SummerMail.'
        )
      : '';
  }

  async _writeKeyHash(keys: KeySet) {
    if (!(await secureStorage.isAvailable())) {
      throw new Error(
        localized(
          `SummerMail could not store your password securely because encryption is not available on this system.`
        ) + this._encryptionUnavailableHint()
      );
    }
    const enrcyptedCredentials = await secureStorage.encrypt(JSON.stringify(keys));
    AppEnv.config.set(configCredentialsKey, enrcyptedCredentials);
  }

  _reportFatalError(err: Error): never {
    // Several credential consumers can fail together during startup. Show the user one dialog,
    // but continue throwing every error so no caller proceeds with missing credentials.
    if (this._fatalErrorReported) {
      (err as any).noSentry = true;
      throw err;
    }
    this._fatalErrorReported = true;

    require('@electron/remote').dialog.showMessageBoxSync({
      type: 'error',
      buttons: [localized('Quit')],
      message: err.message || localized(`SummerMail could not store your password securely.`),
    });

    // tell the app to exit and rethrow the error to ensure code relying
    // on the passwords being saved never runs (saving identity for example).
    // Mark as user-visible so the global error handler does not also report
    // it to Sentry — the user has already been informed via the dialog above.
    (err as any).noSentry = true;
    require('@electron/remote').app.quit();
    throw err;
  }
}

export default new KeyManager();
