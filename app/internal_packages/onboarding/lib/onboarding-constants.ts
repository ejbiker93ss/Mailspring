import crypto from 'crypto';

export const LOCAL_SERVER_PORT = 12141;

export const GMAIL_CLIENT_ID =
  process.env.MS_GMAIL_CLIENT_ID ||
  '662287800555-pdiq3r3puob8a44locitndbocua7c30f.apps.googleusercontent.com';

// per https://stackoverflow.com/questions/59416326/safely-distribute-oauth-2-0-client-secret-in-desktop-applications-in-python,
// we really do need to embed this in the application and it's more an extension of the Client ID than a proper Client Secret.
//
// We could run a small web app that receives the code and exchanges it for the refresh token (storing this on the server), but
// that web flow would still hand the resulting client secret to the desktop app, whose authenticity it can't verify.
// (It can verify the connection is secure, but not that the receiving party is /this/ copy of Mailspring.)
//
// Note: This is not a security risk for the end-user -- it just means someone could "fork" Mailspring and re-use it's
// Client ID and Secret. For now, it seems we're on the honor code - Please don't do this.
//
export const GMAIL_CLIENT_SECRET =
  process.env.MS_GMAIL_CLIENT_SECRET ||
  crypto
    .createDecipheriv(
      'aes-256-ctr',
      "don't-be-ev1l-thanks--mailspring",
      Buffer.from('wgvAx+N05nHqhFxJ9I07jw==', 'base64')
    )
    .update(Buffer.from('1EyEGYVh3NBNIbYEdpdMvOzCH7+vrSciGeYZ1F+W6W+yShk=', 'base64'))
    .toString('utf8');

export const GMAIL_SCOPES = [
  'https://mail.google.com/', // email
  'https://www.googleapis.com/auth/userinfo.email', // email address
  'https://www.googleapis.com/auth/userinfo.profile', // G+ profile
  'https://www.googleapis.com/auth/contacts', // contacts
  'https://www.googleapis.com/auth/calendar', // calendar
];

export const O365_CLIENT_ID =
  process.env.MS_O365_CLIENT_ID || '8787a430-6eee-41e1-b914-681d90d35625';

export const O365_SCOPES = [
  'openid', // required for id_token to be returned
  'email', // email claim in id_token
  'profile', // displayName / name claims in id_token
  'user.read', // email address via Graph /me
  'offline_access',
  'Contacts.ReadWrite', // contacts
  'Contacts.ReadWrite.Shared', // contacts
  'Calendars.ReadWrite', // calendar
  'Calendars.ReadWrite.Shared', // calendar
  'Mail.ReadWrite', // mail sync through Microsoft Graph
  'Mail.ReadWrite.Shared', // shared mailboxes granted to the signed-in user
  'Mail.Send', // sending through Microsoft Graph
  'Mail.Send.Shared', // send-as / send-on-behalf for shared mailboxes
];

// Re-created only at onboarding page load / auth session start because storing
// verifier would require additional state refactoring
export const CODE_VERIFIER = crypto.randomUUID();
export const CODE_CHALLENGE = crypto
  .createHash('sha256')
  .update(CODE_VERIFIER, 'utf8')
  .digest('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=/g, '');
