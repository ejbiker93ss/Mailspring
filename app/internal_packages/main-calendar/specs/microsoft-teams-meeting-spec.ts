import {
  formatTeamsMeetingDescription,
  normalizeOnlineMeeting,
} from '../lib/core/microsoft-teams-meeting';
import { MICROSOFT_TEAMS_GRAPH_SCOPES } from '../lib/core/microsoft-teams-connection';

describe('Microsoft Teams meeting helpers', () => {
  it('uses Graph-only authorization without IMAP or SMTP permissions', () => {
    expect(MICROSOFT_TEAMS_GRAPH_SCOPES).toContain('Calendars.ReadWrite');
    expect(MICROSOFT_TEAMS_GRAPH_SCOPES.join(' ')).not.toContain('IMAP');
    expect(MICROSOFT_TEAMS_GRAPH_SCOPES.join(' ')).not.toContain('SMTP');
  });

  it('extracts the join link and all available phone details', () => {
    const details = normalizeOnlineMeeting(
      {
        id: 'graph-event-id',
        onlineMeeting: {
          joinUrl: 'https://teams.microsoft.com/l/meetup-join/example',
          conferenceId: '123 456 789',
          quickDial: 'tel:+13125550100,,123456789#',
          tollNumber: '+1 312 555 0100',
          tollFreeNumbers: ['+1 800 555 0100'],
          phones: [
            { number: '+1 312 555 0100', type: 'toll' },
            { number: '+44 20 5555 0100', type: 'toll' },
          ],
        },
      },
      'host@example.com'
    );

    expect(details.eventId).toBe('graph-event-id');
    expect(details.tollNumbers).toEqual(['+1 312 555 0100', '+44 20 5555 0100']);
    expect(details.tollFreeNumbers).toEqual(['+1 800 555 0100']);
    expect(details.conferenceId).toBe('123 456 789');
  });

  it('builds invitation text with web, phone, conference, and host details', () => {
    const description = formatTeamsMeetingDescription({
      eventId: 'event-id',
      hostEmail: 'host@example.com',
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/example',
      conferenceId: '123 456 789',
      tollNumbers: ['+1 312 555 0100'],
      tollFreeNumbers: [],
    });

    expect(description).toContain('Join: https://teams.microsoft.com/l/meetup-join/example');
    expect(description).toContain('Call in: +1 312 555 0100');
    expect(description).toContain('Conference ID: 123 456 789');
    expect(description).toContain('Teams host: host@example.com');
  });

  it('fails instead of creating an invitation with no Teams join link', () => {
    expect(() => normalizeOnlineMeeting({ id: 'event-id' }, 'host@example.com')).toThrow();
  });
});
