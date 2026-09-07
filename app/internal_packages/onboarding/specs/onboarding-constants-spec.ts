import {
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  LEGACY_GMAIL_CLIENT_ID,
  LEGACY_GMAIL_CLIENT_SECRET,
  SUMMERMAIL_GMAIL_CLIENT_ID,
} from '../lib/onboarding-constants';

describe('onboarding constants', function () {
  it('decodes a valid Google OAuth client secret', function () {
    expect(SUMMERMAIL_GMAIL_CLIENT_ID).toBe(
      '801963813541-pq2fivhovp4j5efg3hknfcfjnsq6sldd.apps.googleusercontent.com'
    );
    expect(GMAIL_CLIENT_ID).toMatch(/\.apps\.googleusercontent\.com$/);
    expect(GMAIL_CLIENT_SECRET).toMatch(/^[\x21-\x7e]+$/);
    expect(GMAIL_CLIENT_SECRET.length).toBeGreaterThan(20);
    expect(LEGACY_GMAIL_CLIENT_ID).not.toBe(GMAIL_CLIENT_ID);
    expect(LEGACY_GMAIL_CLIENT_SECRET).toMatch(/^[\x21-\x7e]+$/);
    expect(LEGACY_GMAIL_CLIENT_SECRET.length).toBeGreaterThan(20);
  });
});
