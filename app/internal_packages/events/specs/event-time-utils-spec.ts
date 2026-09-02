import ICAL from 'ical.js';
import { eventTimeInZone } from '../lib/event-time-utils';

function eventFromICS(ics: string): ICAL.Event {
  const root = new ICAL.Component(ICAL.parse(ics));
  return new ICAL.Event(root.getFirstSubcomponent('vevent'));
}

describe('eventTimeInZone', () => {
  it('uses the explicit Windows TZID even when the embedded zone has an IANA alias', () => {
    const event = eventFromICS(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:America/New_York
END:VTIMEZONE
BEGIN:VEVENT
UID:windows-zone-invite
DTSTART;TZID=Eastern Standard Time:20260902T103000
DTEND;TZID=Eastern Standard Time:20260902T110000
END:VEVENT
END:VCALENDAR`);

    // Reproduce the synced-copy failure: ical.js can resolve the Time object's
    // zone as UTC even though the DTSTART / DTEND properties retain their TZID.
    (event.component.getFirstProperty('dtstart').getFirstValue() as ICAL.Time).zone =
      ICAL.Timezone.utcTimezone;
    (event.component.getFirstProperty('dtend').getFirstValue() as ICAL.Time).zone =
      ICAL.Timezone.utcTimezone;

    const start = eventTimeInZone(event, 'dtstart', 'America/Chicago');
    const end = eventTimeInZone(event, 'dtend', 'America/Chicago');

    expect(start.format('YYYY-MM-DD HH:mm z')).toBe('2026-09-02 09:30 CDT');
    expect(end.format('YYYY-MM-DD HH:mm z')).toBe('2026-09-02 10:00 CDT');
  });

  it('converts UTC event times into the display timezone', () => {
    const event = eventFromICS(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:utc-invite
DTSTART:20260902T153000Z
DTEND:20260902T160000Z
END:VEVENT
END:VCALENDAR`);

    expect(eventTimeInZone(event, 'dtstart', 'America/Chicago').format('HH:mm z')).toBe(
      '10:30 CDT'
    );
  });

  it('keeps floating and all-day values on their stated local date', () => {
    const floating = eventFromICS(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:floating-invite
DTSTART:20260902T103000
DTEND:20260902T110000
END:VEVENT
END:VCALENDAR`);
    const allDay = eventFromICS(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:all-day-invite
DTSTART;VALUE=DATE:20260902
DTEND;VALUE=DATE:20260903
END:VEVENT
END:VCALENDAR`);

    expect(eventTimeInZone(floating, 'dtstart', 'America/Chicago').format('HH:mm')).toBe('10:30');
    expect(eventTimeInZone(allDay, 'dtstart', 'America/Chicago').format('YYYY-MM-DD')).toBe(
      '2026-09-02'
    );
  });
});
