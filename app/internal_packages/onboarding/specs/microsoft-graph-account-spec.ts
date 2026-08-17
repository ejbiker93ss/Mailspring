import { O365_SCOPES } from '../lib/onboarding-constants';
import { buildO365AuthURL } from '../lib/onboarding-helpers';

describe('Microsoft Graph mail onboarding', () => {
  it('requests Graph mail permissions without legacy IMAP or SMTP scopes', () => {
    expect(O365_SCOPES).toContain('Mail.ReadWrite');
    expect(O365_SCOPES).toContain('Mail.ReadWrite.Shared');
    expect(O365_SCOPES).toContain('Mail.Send');
    expect(O365_SCOPES).toContain('Mail.Send.Shared');
    expect(O365_SCOPES.some((scope) => scope.includes('IMAP.AccessAsUser'))).toBe(false);
    expect(O365_SCOPES.some((scope) => scope.includes('SMTP.Send'))).toBe(false);

    const authURL = new URL(buildO365AuthURL());
    const scopes = (authURL.searchParams.get('scope') || '').split(' ');
    expect(scopes).toContain('Mail.ReadWrite');
    expect(scopes).toContain('Mail.Send');
  });
});
