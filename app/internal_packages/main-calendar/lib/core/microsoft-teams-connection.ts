import crypto from 'crypto';
import http from 'http';
import { shell } from 'electron';
import { Account, KeyManager, localized } from 'mailspring-exports';

import { LOCAL_SERVER_PORT, O365_CLIENT_ID } from '../../../onboarding/lib/onboarding-constants';

export const MICROSOFT_TEAMS_CONNECTION_ID = 'microsoft-teams-graph';
export const MICROSOFT_TEAMS_CONNECTION_CONFIG_KEY = 'mailspring.microsoftTeamsConnection';
const MICROSOFT_TEAMS_REFRESH_TOKEN_KEY = 'microsoft-teams-graph-refresh-token';
const REDIRECT_URI = `http://localhost:${LOCAL_SERVER_PORT}/desktop`;
export const MICROSOFT_TEAMS_GRAPH_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite',
];

export interface MicrosoftTeamsConnection {
  id: typeof MICROSOFT_TEAMS_CONNECTION_ID;
  emailAddress: string;
  name: string;
}

export interface MicrosoftTeamsHost {
  id: string;
  emailAddress: string;
  name?: string;
  account?: Account;
  graphOnly?: boolean;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

function base64Url(value: Buffer) {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function parseJSONResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    throw new Error(
      body.error_description ||
        body.error?.message ||
        body.error ||
        localized('Microsoft sign-in failed (%@).', response.status)
    );
  }
  return body;
}

async function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: O365_CLIENT_ID,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      scope: MICROSOFT_TEAMS_GRAPH_SCOPES.join(' '),
    }).toString(),
  });
  return parseJSONResponse(response);
}

function authorizeInBrowser(authUrl: string, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, code?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      if (error) reject(error);
      else resolve(code);
    };
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || '/', REDIRECT_URI);
      if (requestUrl.pathname !== '/desktop') {
        response.writeHead(404).end();
        return;
      }
      const oauthError =
        requestUrl.searchParams.get('error_description') || requestUrl.searchParams.get('error');
      const returnedState = requestUrl.searchParams.get('state');
      const code = requestUrl.searchParams.get('code');
      if (oauthError) {
        response.end(localized('Microsoft sign-in was cancelled. You can close this window.'));
        finish(new Error(oauthError));
        return;
      }
      if (!code || returnedState !== state) {
        response.writeHead(400).end('Invalid OAuth response');
        finish(new Error(localized('Microsoft returned an invalid sign-in response.')));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><title>Connected</title><body style="font-family:system-ui;padding:40px">Microsoft Teams is connected. You can close this window.</body>'
      );
      finish(undefined, code);
    });
    server.once('error', (error) => finish(error));
    server.listen(LOCAL_SERVER_PORT, () => {
      shell.openExternal(authUrl).catch((error) => finish(error));
    });
    const timeout = setTimeout(
      () => finish(new Error(localized('Microsoft sign-in timed out. Please try again.'))),
      5 * 60 * 1000
    );
  });
}

export function getMicrosoftTeamsConnection(): MicrosoftTeamsConnection | null {
  const value = AppEnv.config.get(MICROSOFT_TEAMS_CONNECTION_CONFIG_KEY);
  if (!value?.emailAddress) return null;
  return {
    id: MICROSOFT_TEAMS_CONNECTION_ID,
    emailAddress: value.emailAddress,
    name: value.name || value.emailAddress,
  };
}

export function getMicrosoftTeamsHosts(accounts: Account[] = []): MicrosoftTeamsHost[] {
  const connection = getMicrosoftTeamsConnection();
  const graphHost: MicrosoftTeamsHost[] = connection ? [{ ...connection, graphOnly: true }] : [];
  const mailHosts = accounts
    .filter((account) => ['office365', 'outlook'].includes(account.provider))
    .map((account) => ({
      id: account.id,
      emailAddress: account.emailAddress,
      name: account.name,
      account,
    }));
  return [
    ...graphHost,
    ...mailHosts.filter((host) => host.emailAddress !== connection?.emailAddress),
  ];
}

export function microsoftTeamsHostForId(
  id: string,
  accounts: Account[] = []
): MicrosoftTeamsHost | null {
  return getMicrosoftTeamsHosts(accounts).find((host) => host.id === id) || null;
}

export async function connectMicrosoftTeams(): Promise<MicrosoftTeamsConnection> {
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64Url(crypto.randomBytes(24));
  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${new URLSearchParams(
    {
      client_id: O365_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      response_mode: 'query',
      scope: MICROSOFT_TEAMS_GRAPH_SCOPES.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      prompt: 'select_account',
    }
  ).toString()}`;

  const token = await authorizeInBrowser(authUrl, state);
  const tokens = await exchangeCode(token, verifier);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error(localized('Microsoft did not return the credentials needed for Teams.'));
  }

  const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await parseJSONResponse(profileResponse);
  const emailAddress = profile.mail || profile.userPrincipalName;
  if (!emailAddress) {
    throw new Error(localized('This Microsoft account does not have an email identity.'));
  }
  const connection: MicrosoftTeamsConnection = {
    id: MICROSOFT_TEAMS_CONNECTION_ID,
    emailAddress,
    name: profile.displayName || emailAddress,
  };
  await KeyManager.replacePassword(MICROSOFT_TEAMS_REFRESH_TOKEN_KEY, tokens.refresh_token);
  AppEnv.config.set(MICROSOFT_TEAMS_CONNECTION_CONFIG_KEY, connection);
  AppEnv.config.set('mailspring.teamsHostAccountId', connection.id);
  return connection;
}

export async function disconnectMicrosoftTeams(): Promise<void> {
  await KeyManager.deletePassword(MICROSOFT_TEAMS_REFRESH_TOKEN_KEY);
  AppEnv.config.set(MICROSOFT_TEAMS_CONNECTION_CONFIG_KEY, null);
  if (AppEnv.config.get('mailspring.teamsHostAccountId') === MICROSOFT_TEAMS_CONNECTION_ID) {
    AppEnv.config.set('mailspring.teamsHostAccountId', null);
  }
}

export async function getMicrosoftTeamsGraphAccessToken(): Promise<string> {
  const refreshToken = await KeyManager.getPassword(MICROSOFT_TEAMS_REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    throw new Error(localized('Connect Microsoft Teams in AI Assistant settings first.'));
  }
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: O365_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: MICROSOFT_TEAMS_GRAPH_SCOPES.join(' '),
    }).toString(),
  });
  const token = await parseJSONResponse(response);
  if (!token.access_token) {
    throw new Error(localized('Microsoft did not return a Graph access token.'));
  }
  if (token.refresh_token && token.refresh_token !== refreshToken) {
    await KeyManager.replacePassword(MICROSOFT_TEAMS_REFRESH_TOKEN_KEY, token.refresh_token);
  }
  return token.access_token;
}
