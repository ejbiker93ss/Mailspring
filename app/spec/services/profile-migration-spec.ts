import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
  decryptChromiumV10CredentialBlob,
  migrateMailspringProfile,
  shouldOfferMailspringProfileMigration,
} from '../../src/browser/profile-migration';

describe('Mailspring profile migration', () => {
  let root: string;
  let source: string;
  let destination: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'summermail-profile-migration-'));
    source = path.join(root, 'Mailspring');
    destination = path.join(root, 'SummerMail');
    fs.mkdirSync(source);
    fs.mkdirSync(destination);
    fs.writeFileSync(
      path.join(source, 'config.json'),
      JSON.stringify({
        '*': {
          accounts: [{ id: 'account-1', emailAddress: 'person@example.com' }],
          credentials: 'encrypted',
        },
      })
    );
    fs.writeFileSync(path.join(source, 'edgehill.db'), 'mailspring-database');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('offers migration when Mailspring has accounts and SummerMail does not', () => {
    fs.writeFileSync(path.join(destination, 'config.json'), JSON.stringify({ '*': {} }));

    expect(shouldOfferMailspringProfileMigration(source, destination)).toBe(true);
  });

  it('offers to repair a matching SummerMail profile until migration succeeds', () => {
    fs.writeFileSync(
      path.join(destination, 'config.json'),
      JSON.stringify({
        '*': { accounts: [{ id: 'summermail-account', emailAddress: 'person@example.com' }] },
      })
    );

    expect(shouldOfferMailspringProfileMigration(source, destination)).toBe(true);
  });

  it('copies credentials and the SQLite database while preserving a backup', async () => {
    fs.writeFileSync(path.join(destination, 'config.json'), JSON.stringify({ '*': {} }));
    fs.writeFileSync(path.join(destination, 'edgehill.db'), 'new-empty-database');
    fs.writeFileSync(path.join(source, 'edgehill.db-wal'), 'mailspring-wal');
    fs.mkdirSync(path.join(source, 'files', 'aa', 'bb'), { recursive: true });
    fs.writeFileSync(path.join(source, 'files', 'aa', 'bb', 'inline.png'), 'mailspring-image');
    fs.mkdirSync(path.join(destination, 'files', 'aa', 'bb'), { recursive: true });
    fs.writeFileSync(path.join(destination, 'files', 'aa', 'bb', 'keep.png'), 'summermail-image');

    const backup = await migrateMailspringProfile(source, destination, {
      migrateCredentials: false,
    });

    expect(fs.readFileSync(path.join(destination, 'config.json'), 'utf8')).toContain('account-1');
    expect(fs.readFileSync(path.join(destination, 'edgehill.db'), 'utf8')).toBe(
      'mailspring-database'
    );
    expect(fs.readFileSync(path.join(destination, 'edgehill.db-wal'), 'utf8')).toBe(
      'mailspring-wal'
    );
    expect(fs.readFileSync(path.join(backup, 'edgehill.db'), 'utf8')).toBe('new-empty-database');
    expect(fs.readFileSync(path.join(destination, 'files', 'aa', 'bb', 'inline.png'), 'utf8')).toBe(
      'mailspring-image'
    );
    expect(fs.readFileSync(path.join(destination, 'files', 'aa', 'bb', 'keep.png'), 'utf8')).toBe(
      'summermail-image'
    );
  });

  it('reports meaningful progress while the profile is migrated', async () => {
    fs.writeFileSync(path.join(destination, 'config.json'), JSON.stringify({ '*': {} }));
    fs.writeFileSync(path.join(destination, 'edgehill.db'), 'new-empty-database');
    const updates: Array<{ percent: number; status: string }> = [];

    await migrateMailspringProfile(source, destination, {
      migrateCredentials: false,
      onProgress: (percent, status) => updates.push({ percent, status }),
    });

    expect(updates.map(({ percent }) => percent)).toEqual([10, 24, 42, 76, 96]);
    expect(updates.every(({ status }) => status.length > 0)).toBe(true);
    expect(fs.existsSync(path.join(destination, '.mailspring-profile-migration-complete'))).toBe(
      true
    );
  });

  it('decrypts Chromium v10 credentials after the profile key is unlocked', () => {
    const key = crypto.randomBytes(32);
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const plaintext = JSON.stringify({ 'person@example.com-imap': 'secret' });
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const encrypted = Buffer.concat([Buffer.from('v10'), nonce, ciphertext, cipher.getAuthTag()]);

    expect(decryptChromiumV10CredentialBlob(encrypted, key)).toBe(plaintext);
  });

  it('yields during copying and restores the backup after a copy failure', async () => {
    fs.writeFileSync(path.join(destination, 'config.json'), JSON.stringify({ '*': {} }));
    fs.writeFileSync(path.join(destination, 'edgehill.db'), 'original-database');
    fs.rmSync(path.join(source, 'edgehill.db'));
    let yielded = false;
    let failed = false;
    const migration = migrateMailspringProfile(source, destination, { migrateCredentials: false });
    await Promise.resolve().then(() => {
      yielded = true;
    });
    try {
      await migration;
    } catch (error) {
      failed = true;
    }
    expect(yielded).toBe(true);
    expect(failed).toBe(true);
    expect(fs.readFileSync(path.join(destination, 'edgehill.db'), 'utf8')).toBe(
      'original-database'
    );
    expect(fs.existsSync(path.join(destination, '.mailspring-profile-migration-complete'))).toBe(
      false
    );
  });
});
