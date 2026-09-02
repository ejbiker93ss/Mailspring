import ICAL from 'ical.js';
import moment, { Moment } from 'moment-timezone';
import { findOneIana } from 'windows-iana';

type EventTimeProperty = 'dtstart' | 'dtend';

function timeParts(time: ICAL.Time): [number, number, number, number, number, number] {
  return [time.year, time.month - 1, time.day, time.hour, time.minute, time.second];
}

/**
 * Converts an iCalendar event time into the user's display timezone.
 *
 * The TZID parameter on DTSTART / DTEND is the authoritative source timezone.
 * Reading `time.zone.tzid` instead is unreliable because ical.js keeps a global
 * timezone registry. A calendar sync can register a VTIMEZONE under a different
 * alias and cause a Windows-zone event to be interpreted as UTC.
 */
export function eventTimeInZone(
  event: ICAL.Event,
  propertyName: EventTimeProperty,
  displayTimeZone: string
): Moment {
  const property = event.component.getFirstProperty(propertyName);
  const time = (property?.getFirstValue() ||
    (propertyName === 'dtstart' ? event.startDate : event.endDate)) as ICAL.Time;

  if (!time) {
    return null;
  }

  const parts = timeParts(time);
  const propertyTimezoneValue = property?.getParameter('tzid');
  const propertyTimezone =
    typeof propertyTimezoneValue === 'string' ? propertyTimezoneValue : undefined;
  const timeTimezone = time.zone?.tzid;
  const sourceTimezone = propertyTimezone || timeTimezone;

  // All-day and floating values describe local calendar fields, not an instant.
  // Converting them from UTC can move them to the previous day.
  if (
    time.isDate ||
    !sourceTimezone ||
    sourceTimezone === 'floating' ||
    sourceTimezone === 'local'
  ) {
    return moment.tz(parts, displayTimeZone);
  }

  const normalizedTimezone =
    sourceTimezone === 'Z' ? 'UTC' : findOneIana(sourceTimezone) || sourceTimezone;

  if (normalizedTimezone === 'UTC' || normalizedTimezone === 'Etc/UTC') {
    return moment.utc(parts).tz(displayTimeZone);
  }

  if (moment.tz.zone(normalizedTimezone)) {
    return moment.tz(parts, normalizedTimezone).tz(displayTimeZone);
  }

  // Preserve support for uncommon embedded VTIMEZONE definitions understood by
  // ical.js even when moment-timezone does not recognize their TZID.
  const jsDate = time.toJSDate();
  if (!Number.isNaN(jsDate.getTime())) {
    return moment(jsDate).tz(displayTimeZone);
  }

  return moment.tz(parts, displayTimeZone);
}
