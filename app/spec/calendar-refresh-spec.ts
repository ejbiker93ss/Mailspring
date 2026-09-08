import { CalendarView } from '../internal_packages/main-calendar/lib/core/calendar-constants';
import {
  calendarViewNeedsPeriodicRefresh,
  SummerMailCalendar,
} from '../internal_packages/main-calendar/lib/core/summermail-calendar';
import { EventRSVPTask } from '../src/flux/tasks/event-rsvp-task';
import { Actions, Calendar, DatabaseStore, Event, SyncbackEventTask } from 'summermail-exports';

const ACCEPTED_INVITE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
METHOD:REQUEST
BEGIN:VEVENT
UID:accepted-invite@test
DTSTAMP:20260904T180000Z
DTSTART:20260907T190000Z
DTEND:20260907T203000Z
ORGANIZER:mailto:organizer@example.com
ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:user@example.com
SUMMARY:Accepted meeting
END:VEVENT
END:VCALENDAR`;

describe('Calendar refresh behavior', () => {
  it('periodically refreshes day and agenda views only', () => {
    expect(calendarViewNeedsPeriodicRefresh(CalendarView.DAY)).toBe(true);
    expect(calendarViewNeedsPeriodicRefresh(CalendarView.AGENDA)).toBe(true);
    expect(calendarViewNeedsPeriodicRefresh(CalendarView.WEEK)).toBe(false);
    expect(calendarViewNeedsPeriodicRefresh(CalendarView.MONTH)).toBe(false);
  });

  it('uses calendar sync for the manual refresh command', () => {
    const calendar = new SummerMailCalendar({});
    spyOn(AppEnv.mailsyncBridge, 'sendSyncCalendarNow');

    calendar._onRefreshCalendars();

    expect(AppEnv.mailsyncBridge.sendSyncCalendarNow).toHaveBeenCalled();
  });

  it('refreshes a visible day or agenda view but not other views', () => {
    const calendar = new SummerMailCalendar({});
    spyOn(calendar, '_isCalendarVisible').andReturn(true);
    const refreshSpy = spyOn(calendar, '_onRefreshCalendars');

    (calendar.state as any).view = CalendarView.DAY;
    calendar._refreshCalendarsIfVisible();
    (calendar.state as any).view = CalendarView.AGENDA;
    calendar._refreshCalendarsIfVisible();
    (calendar.state as any).view = CalendarView.WEEK;
    calendar._refreshCalendarsIfVisible();

    expect(refreshSpy.calls.length).toBe(2);
  });

  it('does not refresh a hidden calendar view', () => {
    const calendar = new SummerMailCalendar({});
    (calendar.state as any).view = CalendarView.DAY;
    spyOn(calendar, '_isCalendarVisible').andReturn(false);
    spyOn(calendar, '_onRefreshCalendars');

    calendar._refreshCalendarsIfVisible();

    expect(calendar._onRefreshCalendars).not.toHaveBeenCalled();
  });

  it('syncs the RSVP account when a response completes', async () => {
    const task = new EventRSVPTask({ accountId: 'account-1' } as any);
    spyOn(AppEnv.mailsyncBridge, 'sendSyncCalendarNow');

    await task.onSuccess();

    expect(AppEnv.mailsyncBridge.sendSyncCalendarNow).toHaveBeenCalledWith('account-1');
  });

  it('imports an accepted invite into a writable calendar when it is not already synced', async () => {
    const task = new EventRSVPTask({
      accountId: 'account-1',
      icsOriginalData: ACCEPTED_INVITE_ICS,
      icsRSVPStatus: 'ACCEPTED',
    } as any);
    const calendar = new Calendar({
      id: 'calendar-1',
      accountId: 'account-1',
      name: 'Calendar',
      readOnly: false,
    } as any);
    spyOn(DatabaseStore, 'findBy').andReturn(Promise.resolve(null) as any);
    spyOn(DatabaseStore, 'findAll').andReturn(Promise.resolve([calendar]) as any);
    const queueTask = spyOn(Actions, 'queueTask');

    await task.saveAcceptedEventToCalendar();

    const syncback = queueTask.calls[queueTask.calls.length - 1].args[0] as SyncbackEventTask;
    expect(syncback instanceof SyncbackEventTask).toBe(true);
    expect(syncback.event instanceof Event).toBe(true);
    expect(syncback.event.calendarId).toBe('calendar-1');
    expect(syncback.event.icsuid).toBe('accepted-invite@test');
    expect(syncback.event.ics).not.toContain('METHOD:REQUEST');
  });
});
