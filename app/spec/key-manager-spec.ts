import KeyManager, { secureStorage } from '../src/key-manager';

const CREDENTIALS_KEY = 'credentials';
const storedBlob = () => Buffer.from('encrypted').toJSON();

describe('KeyManager', function () {
  beforeEach(function () {
    (KeyManager as any)._fatalErrorReported = false;
    this.config = {};
    spyOn(AppEnv.config, 'get').andCallFake((key: string) => this.config[key]);
    spyOn(AppEnv.config, 'set').andCallFake((key: string, value: any) => {
      this.config[key] = value;
    });
    spyOn(secureStorage, 'isAvailable').andCallFake(() => Promise.resolve(true));
    spyOn(secureStorage, 'encrypt').andCallFake((plaintext: string) =>
      Promise.resolve(Buffer.from(plaintext))
    );
  });

  it('returns an empty set when nothing has been stored', async function () {
    spyOn(secureStorage, 'decrypt');
    expect(await KeyManager._getKeyHash()).toEqual({});
    expect(secureStorage.decrypt).not.toHaveBeenCalled();
  });

  it('does not overwrite stored credentials when decryption fails', async function () {
    const untouched = storedBlob();
    this.config[CREDENTIALS_KEY] = untouched;
    spyOn(secureStorage, 'decrypt').andCallFake(() => Promise.reject(new Error('keyring locked')));
    spyOn(KeyManager, '_reportFatalError').andCallFake((err: Error) => {
      throw err;
    });

    try {
      await KeyManager.replacePassword('a-imap', 'new');
    } catch (err) {
      // The operation must abort rather than replacing the credential blob with an empty set.
    }
    expect(secureStorage.encrypt).not.toHaveBeenCalled();
    expect(this.config[CREDENTIALS_KEY]).toBe(untouched);
  });

  it('shows only one fatal dialog for concurrent credential failures', function () {
    const remote = require('@electron/remote');
    spyOn(remote.dialog, 'showMessageBoxSync');
    spyOn(remote.app, 'quit');

    for (let i = 0; i < 3; i++) {
      try {
        KeyManager._reportFatalError(new Error('nope'));
      } catch (err) {
        // Every call still throws so callers stop.
      }
    }
    expect((remote.dialog.showMessageBoxSync as jasmine.Spy).calls.length).toBe(1);
    expect((remote.app.quit as jasmine.Spy).calls.length).toBe(1);
  });
});
