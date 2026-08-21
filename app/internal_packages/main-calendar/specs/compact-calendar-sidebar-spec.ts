import moment from 'moment';
import { shouldAdvanceSelectedDate } from '../lib/compact-calendar-sidebar';

describe('CompactCalendarSidebar date rollover', () => {
  it('advances when the sidebar was following today', () => {
    const previousNow = moment('2026-08-20T23:59:00');
    const nextNow = moment('2026-08-21T00:01:00');

    expect(shouldAdvanceSelectedDate(previousNow.clone(), previousNow, nextNow)).toBe(true);
  });

  it('catches up after the app sleeps across multiple days', () => {
    const previousNow = moment('2026-08-20T18:00:00');
    const nextNow = moment('2026-08-23T08:00:00');

    expect(shouldAdvanceSelectedDate(previousNow.clone(), previousNow, nextNow)).toBe(true);
  });

  it('preserves a date the user selected intentionally', () => {
    const previousNow = moment('2026-08-20T23:59:00');
    const selectedDate = moment('2026-08-22T00:00:00');
    const nextNow = moment('2026-08-21T00:01:00');

    expect(shouldAdvanceSelectedDate(selectedDate, previousNow, nextNow)).toBe(false);
  });

  it('does not resubscribe while the local day is unchanged', () => {
    const previousNow = moment('2026-08-20T10:00:00');
    const nextNow = moment('2026-08-20T10:01:00');

    expect(shouldAdvanceSelectedDate(previousNow.clone(), previousNow, nextNow)).toBe(false);
  });
});
