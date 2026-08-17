const https = require('https');
const querystring = require('querystring');

import { Account, KeyManager, localized } from 'mailspring-exports';
import {
  getMicrosoftTeamsGraphAccessToken,
  MicrosoftTeamsHost,
} from './microsoft-teams-connection';

export interface MicrosoftTeamsMeetingDetails {
  eventId: string;
  hostEmail: string;
  joinUrl: string;
  conferenceId?: string;
  quickDial?: string;
  tollNumbers: string[];
  tollFreeNumbers: string[];
}

interface GraphOnlineMeetingInfo {
  conferenceId?: string;
  joinUrl?: string;
  quickDial?: string;
  tollNumber?: string;
  tollFreeNumbers?: string[];
  phones?: Array<{ number?: string; type?: string }>;
}

interface GraphEventResponse {
  id: string;
  onlineMeeting?: GraphOnlineMeetingInfo;
  onlineMeetingUrl?: string;
  error?: { code?: string; message?: string };
}

const GRAPH_SCOPES = 'openid profile offline_access User.Read Calendars.ReadWrite';

function requestJSON<T>(options: any, body?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed: any = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          parsed = { message: raw };
        }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(parsed as T);
          return;
        }
        const detail = parsed.error_description || parsed.error?.message || parsed.message;
        reject(
          new Error(
            detail ||
              localized(
                'Microsoft returned an error while creating the Teams meeting (%@).',
                response.statusCode
              )
          )
        );
      });
    });
    request.on('error', reject);
    request.setTimeout(20000, () => {
      request.destroy(new Error(localized('Microsoft Teams request timed out.')));
    });
    if (body) request.write(body);
    request.end();
  });
}

async function graphAccessToken(host: MicrosoftTeamsHost): Promise<string> {
  if (host.graphOnly) {
    return getMicrosoftTeamsGraphAccessToken();
  }
  const account = host.account;
  if (!account) {
    throw new Error(localized('The selected Microsoft Teams account is no longer available.'));
  }
  const accountWithSecrets = await KeyManager.insertAccountSecrets(account);
  const settings = accountWithSecrets.settings as any;
  const clientId = settings.refresh_client_id;
  const refreshToken = settings.refresh_token;
  if (!clientId || !refreshToken) {
    throw new Error(localized('Reconnect this Microsoft account before creating a Teams meeting.'));
  }

  const body = querystring.stringify({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: GRAPH_SCOPES,
  });
  const response = await requestJSON<{ access_token?: string }>(
    {
      hostname: 'login.microsoftonline.com',
      path: '/common/oauth2/v2.0/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body
  );
  if (!response.access_token) {
    throw new Error(localized('Microsoft did not return a Graph access token.'));
  }
  return response.access_token;
}

async function graphRequest<T>(
  accessToken: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  payload?: Record<string, any>
): Promise<T> {
  const body = payload ? JSON.stringify(payload) : undefined;
  return requestJSON<T>(
    {
      hostname: 'graph.microsoft.com',
      path: `/v1.0${path}`,
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            }
          : {}),
      },
    },
    body
  );
}

function graphDateTime(date: Date) {
  return { dateTime: date.toISOString().replace(/\.\d{3}Z$/, ''), timeZone: 'UTC' };
}

export function isMicrosoftTeamsAccount(account: Account) {
  return account && ['office365', 'outlook'].includes(account.provider);
}

export function normalizeOnlineMeeting(
  event: GraphEventResponse,
  hostEmail: string
): MicrosoftTeamsMeetingDetails {
  const online = event.onlineMeeting || {};
  const phoneNumbers = (online.phones || []).map((phone) => phone.number).filter(Boolean);
  const tollNumbers = Array.from(new Set([online.tollNumber, ...phoneNumbers].filter(Boolean)));
  const joinUrl = online.joinUrl || event.onlineMeetingUrl;
  if (!event.id || !joinUrl) {
    throw new Error(
      localized(
        'Microsoft created the event but did not enable Teams. Check that this account has Teams and Exchange Online enabled.'
      )
    );
  }
  return {
    eventId: event.id,
    hostEmail,
    joinUrl,
    conferenceId: online.conferenceId,
    quickDial: online.quickDial,
    tollNumbers,
    tollFreeNumbers: online.tollFreeNumbers || [],
  };
}

export function formatTeamsMeetingDescription(details: MicrosoftTeamsMeetingDetails): string {
  const lines = ['Microsoft Teams meeting', `Join: ${details.joinUrl}`, ''];
  if (details.tollNumbers.length) {
    lines.push(`Call in: ${details.tollNumbers.join(', ')}`);
  }
  if (details.tollFreeNumbers.length) {
    lines.push(`Toll-free: ${details.tollFreeNumbers.join(', ')}`);
  }
  if (details.conferenceId) {
    lines.push(`Conference ID: ${details.conferenceId}`);
  }
  if (details.quickDial) {
    lines.push(`Quick dial: ${details.quickDial}`);
  }
  lines.push(`Teams host: ${details.hostEmail}`);
  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');
}

export async function createMicrosoftTeamsMeeting(options: {
  host: MicrosoftTeamsHost;
  subject: string;
  start: Date;
  end: Date;
  description?: string;
  attendees?: Array<{ email: string; name?: string }>;
  sendMicrosoftInvitations?: boolean;
  transactionId: string;
}): Promise<MicrosoftTeamsMeetingDetails> {
  if (!options.host?.graphOnly && !isMicrosoftTeamsAccount(options.host?.account)) {
    throw new Error(localized('Choose a Microsoft 365 account to host the Teams meeting.'));
  }
  const accessToken = await graphAccessToken(options.host);
  const payload: Record<string, any> = {
    subject: options.subject,
    body: { contentType: 'text', content: options.description || '' },
    start: graphDateTime(options.start),
    end: graphDateTime(options.end),
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness',
    transactionId: options.transactionId,
  };
  if (options.sendMicrosoftInvitations && options.attendees?.length) {
    payload.attendees = options.attendees.map((attendee) => ({
      emailAddress: { address: attendee.email, name: attendee.name || attendee.email },
      type: 'required',
    }));
  }
  let event = await graphRequest<GraphEventResponse>(accessToken, 'POST', '/me/events', payload);
  if (!event.onlineMeeting?.joinUrl && !event.onlineMeetingUrl && event.id) {
    event = await graphRequest<GraphEventResponse>(
      accessToken,
      'GET',
      `/me/events/${encodeURIComponent(event.id)}?$select=id,onlineMeeting,onlineMeetingUrl`
    );
  }
  try {
    return normalizeOnlineMeeting(event, options.host.emailAddress);
  } catch (error) {
    if (event.id) {
      try {
        await graphRequest(accessToken, 'DELETE', `/me/events/${encodeURIComponent(event.id)}`);
      } catch (cleanupError) {
        console.warn('Unable to clean up incomplete Microsoft Teams event:', cleanupError);
      }
    }
    throw error;
  }
}

export async function deleteMicrosoftTeamsMeeting(
  host: MicrosoftTeamsHost,
  eventId: string
): Promise<void> {
  try {
    const accessToken = await graphAccessToken(host);
    await graphRequest(accessToken, 'DELETE', `/me/events/${encodeURIComponent(eventId)}`);
  } catch (error) {
    console.warn('Unable to clean up Microsoft Teams host event:', error);
  }
}
