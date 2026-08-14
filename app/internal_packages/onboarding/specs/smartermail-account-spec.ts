import { Account } from 'mailspring-exports';
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
      },
    });

    const result = buildSmarterMailAccount(account);

    expect(result.settings.imap_host).toBe('mail.example.com');
    expect(result.settings.imap_port).toBe(993);
    expect(result.settings.smtp_host).toBe('mail.example.com');
    expect(result.settings.smtp_port).toBe(465);
    expect(result.settings.caldav_host).toBe('https://mail.example.com/WebDAV/');
    expect(result.settings.carddav_host).toBe('https://mail.example.com/WebDAV/');
    expect(result.settings.caldav_username).toBe('alice@example.com');
  });
});
