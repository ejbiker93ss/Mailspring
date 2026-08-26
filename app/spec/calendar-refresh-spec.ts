import { CalendarView } from '../internal_packages/main-calendar/lib/core/calendar-constants';
import {
  calendarViewNeedsPeriodicRefresh,
  MailspringCalendar,
} from '../internal_packages/main-calendar/lib/core/mailspring-calendar';
import { EventRSVPTask } from '../src/flux/tasks/event-rsvp-task';

describe('Calendar refresh behavior', () => {
  it('periodically refreshes day and agenda views only', () => {
    expect(calendarViewNeedsPeriodicRefresh(CalendarView.DAY)).toBe(true);
    expect(calendarViewNeedsPeriodicRefresh(CalendarView.AGENDA)).toBe(true);
    expect(calendarViewNeedsPeriodicRefresh(CalendarView.WEEK)).toBe(false);
    expect(calendarViewNeedsPeriodicRefresh(CalendarView.MONTH)).toBe(false);
  });

  it('uses calendar sync for the manual refresh command', () => {
    const calendar = new MailspringCalendar({});
    spyOn(AppEnv.mailsyncBridge, 'sendSyncCalendarNow');

    calendar._onRefreshCalendars();

    expect(AppEnv.mailsyncBridge.sendSyncCalendarNow).toHaveBeenCalled();
  });

  it('refreshes a visible day or agenda view but not other views', () => {
    const calendar = new MailspringCalendar({});
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
    const calendar = new MailspringCalendar({});
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
});
