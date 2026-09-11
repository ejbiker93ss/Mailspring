import { AutoDiscovery, createClient, IndexedDBStore, MatrixClient } from 'matrix-js-sdk';

const MATRIX_DEVICE_NAME = 'SummerMail Chat';

const MATRIX_SYNC_DB_NAME = 'summermail-matrix-store';
const MATRIX_CRYPTO_DB_NAMES = [
  'matrix-js-sdk::matrix-sdk-crypto',
  'matrix-js-sdk::matrix-sdk-crypto-meta',
];

export interface MatrixSessionCredentials {
  accessToken: string;
  baseUrl: string;
  deviceId: string;
  userId: string;
}

export function parseMatrixLogin(raw: string): { username: string; domain: string } | null {
  const value = String(raw || '').trim();
  const match = /^@?([^:@\s]+):([^:@\s]+)$/.exec(value);
  if (!match) return null;
  return { username: match[1], domain: match[2].toLowerCase() };
}

export function parseHomeserverInput(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'https:' || !parsed.hostname) return null;
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    parsed.search = '';
    if (parsed.pathname === '/') parsed.pathname = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function resolveMatrixLogin(
  login: string,
  homeserver?: string
): { username: string; domain: string; homeserverUrl?: string } | null {
  const parsedLogin = parseMatrixLogin(login);
  const username =
    parsedLogin?.username ||
    String(login || '')
      .replace(/^@/, '')
      .trim();
  if (!username || username.includes(':') || username.includes('/')) return parsedLogin;
  const homeserverUrl = parseHomeserverInput(homeserver || '');
  const domain = parsedLogin?.domain || (homeserverUrl ? new URL(homeserverUrl).hostname : '');
  if (!username || !domain) return null;
  return { username, domain, homeserverUrl: homeserverUrl || undefined };
}

export function formatLoginError(error: unknown): string {
  const err = error as {
    errcode?: string;
    httpStatus?: number;
    message?: string;
    data?: { error?: string; errcode?: string };
  };
  const code = err?.errcode || err?.data?.errcode;
  if (code === 'M_FORBIDDEN' || err?.httpStatus === 403) {
    return 'That username or password was not accepted.';
  }
  if (code === 'M_LIMIT_EXCEEDED' || err?.httpStatus === 429) {
    return 'The homeserver asked us to wait before trying again.';
  }
  if (code === 'M_USER_DEACTIVATED') {
    return 'This Matrix account has been deactivated.';
  }
  const message = err?.data?.error || err?.message;
  return message ? String(message) : 'Could not sign in to Matrix.';
}

function isCryptoStoreMismatch(error: unknown): boolean {
  const message = String((error as { message?: string })?.message || error || '');
  return /account in the store doesn't match/i.test(message);
}

function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = window.indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export async function clearMatrixLocalStores(): Promise<void> {
  await Promise.all([MATRIX_SYNC_DB_NAME, ...MATRIX_CRYPTO_DB_NAMES].map(deleteIndexedDb));
}

export async function discoverHomeserverUrlForDomain(
  domain: string,
  explicitUrl?: string
): Promise<string> {
  const normalizedExplicit = parseHomeserverInput(explicitUrl || '');
  if (normalizedExplicit) {
    try {
      const response = await fetch(`${normalizedExplicit}/_matrix/client/versions`);
      if (response.ok) return normalizedExplicit;
    } catch {
      // A domain like example.com may still resolve through well-known discovery.
    }
  }

  const discovered = await AutoDiscovery.findClientConfig(domain);
  const homeserver = discovered?.['m.homeserver'];
  if (homeserver?.state === AutoDiscovery.SUCCESS && homeserver.base_url) {
    return new URL(homeserver.base_url).toString().replace(/\/$/, '');
  }

  const fallback = normalizedExplicit || `https://${domain}`;
  try {
    const response = await fetch(`${fallback}/_matrix/client/versions`);
    if (response.ok) return fallback.replace(/\/$/, '');
  } catch {
    // Fall through to a clearer error below.
  }
  throw new Error('Could not find a Matrix homeserver for that address.');
}

export async function discoverHomeserverUrl(login: string, homeserver?: string): Promise<string> {
  const parsed = resolveMatrixLogin(login, homeserver);
  if (!parsed) {
    throw new Error('Enter a username and homeserver, or a Matrix ID such as @you:example.com.');
  }
  return discoverHomeserverUrlForDomain(parsed.domain, parsed.homeserverUrl);
}

export async function createMatrixClient(
  credentials: MatrixSessionCredentials
): Promise<MatrixClient> {
  const store = new IndexedDBStore({
    indexedDB: window.indexedDB,
    dbName: MATRIX_SYNC_DB_NAME,
    localStorage: window.localStorage,
  });
  const client = createClient({
    baseUrl: credentials.baseUrl,
    accessToken: credentials.accessToken,
    userId: credentials.userId,
    deviceId: credentials.deviceId,
    store,
    timelineSupport: true,
  });
  await store.startup();
  try {
    await client.initRustCrypto({ useIndexedDB: true });
  } catch (error) {
    if (!isCryptoStoreMismatch(error)) throw error;
    await clearMatrixLocalStores();
    return createMatrixClient(credentials);
  }
  return client;
}

export async function loginToMatrix(
  login: string,
  password: string,
  homeserver?: string
): Promise<{
  client: MatrixClient;
  credentials: MatrixSessionCredentials;
}> {
  const parsed = resolveMatrixLogin(login, homeserver);
  if (!parsed) {
    throw new Error('Enter a username and homeserver, or a Matrix ID such as @you:example.com.');
  }
  if (!password.trim()) {
    throw new Error('Enter your Matrix password.');
  }

  const baseUrl = await discoverHomeserverUrlForDomain(parsed.domain, parsed.homeserverUrl);
  const authClient = createClient({ baseUrl });
  const response = await authClient.loginRequest({
    type: 'm.login.password',
    identifier: {
      type: 'm.id.user',
      user: parsed.username,
    },
    password,
    initial_device_display_name: MATRIX_DEVICE_NAME,
  });

  const credentials: MatrixSessionCredentials = {
    accessToken: response.access_token,
    baseUrl,
    deviceId: response.device_id,
    userId: response.user_id,
  };
  const client = await createMatrixClient(credentials);
  return { client, credentials };
}
