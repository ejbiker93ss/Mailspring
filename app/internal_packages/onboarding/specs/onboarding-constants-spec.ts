import { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET } from '../lib/onboarding-constants';

describe('onboarding constants', function () {
  it('decodes a valid Google OAuth client secret', function () {
    expect(GMAIL_CLIENT_ID).toMatch(/\.apps\.googleusercontent\.com$/);
    expect(GMAIL_CLIENT_SECRET).toMatch(/^[\x21-\x7e]+$/);
    expect(GMAIL_CLIENT_SECRET.length).toBeGreaterThan(20);
  });
});
