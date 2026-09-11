import { Account } from 'summermail-exports';
import { buildSmarterMailAccount, normalizeSmarterMailServerURL } from '../lib/onboarding-helpers';

describe('SmarterMail account setup', () => {
  it('normalizes a server hostname to HTTPS', () => {
    expect(normalizeSmarterMailServerURL('mail.example.com/')).toBe('https://mail.example.com');
  });

  it('rejects an insecure server URL', () => {
    expect(() => normalizeSmarterMailServerURL('http://mail.example.com')).toThrow();
  });

  it('builds mail and WebDAV settings from one server URL', () => {
    const account = new Account({
      name: 'Alice',
      emailAddress: 'alice@example.com',
      provider: 'smartermail',
      settings: {
        smartermail_server: 'https://mail.example.com',
        imap_password: 'secret',
        caldav_password: 'separate-webdav-secret',
      },
    });

    const result = buildSmarterMailAccount(account);

    expect(result.settings.imap_host).toBe('mail.example.com');
    expect(result.settings.imap_port).toBe(993);
    expect(result.settings.smtp_host).toBe('mail.example.com');
    expect(result.settings.smtp_port).toBe(465);
    expect(result.settings.sync_engine).toBe('smartermail_api');
    expect(result.settings.caldav_host).toBe('https://mail.example.com/WebDAV/');
    expect(result.settings.carddav_host).toBe('https://mail.example.com/WebDAV/');
    expect(result.settings.caldav_username).toBe('alice@example.com');
    expect(result.settings.caldav_password).toBe('separate-webdav-secret');
    expect(result.settings.imap_password).toBe('secret');
    expect(result.settings.smtp_password).toBe('secret');
  });
});
