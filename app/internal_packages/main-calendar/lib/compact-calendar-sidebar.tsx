import moment, { Moment } from 'moment';
import React from 'react';
import { Actions, localized, WorkspaceStore } from 'mailspring-exports';
import { MiniMonthView } from 'mailspring-component-kit';
import { CalendarDataSource, EventOccurrence } from './core/calendar-data-source';
import { calcEventColors } from './core/calendar-helpers';

type SidebarMode = 'day' | 'agenda';

const AGENDA_MONTHS_IN_VIEW = 6;

export function shouldAdvanceSelectedDate(
  selectedDate: Moment,
  previousNow: Moment,
  nextNow: Moment
) {
  return !nextNow.isSame(previousNow, 'day') && selectedDate.isSame(previousNow, 'day');
}

interface CompactCalendarSidebarState {
  selectedDate: Moment;
  events: EventOccurrence[];
  mode: SidebarMode;
  now: Moment;
  monthVisible: boolean;
}

const Icon = ({
  name,
}: {
  name: 'calendar' | 'chevron-left' | 'chevron-right' | 'plus' | 'up';
}) => {
  const paths = {
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </>
    ),
    'chevron-left': <path d="m15 18-6-6 6-6" />,
    'chevron-right': <path d="m9 18 6-6-6-6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    up: <path d="m7 14 5-5 5 5" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
};

export class CompactCalendarSidebar extends React.Component<
  Record<string, never>,
  CompactCalendarSidebarState
> {
  static displayName = 'CompactCalendarSidebar';

  static containerStyles = {
    order: -100,
    flex: 1,
    minWidth: 280,
    maxWidth: 340,
  };

  private dataSource = new CalendarDataSource();
  private eventSubscription?: { dispose(): void };
  private clockInterval?: number;
  private hoursScroll?: HTMLDivElement;

  constructor(props) {
    super(props);
    this.state = {
      selectedDate: moment().startOf('day'),
      events: [],
      mode: 'day',
      now: moment(),
      monthVisible: true,
    };
  }

  componentDidMount() {
    this.subscribeToDate(this.state.selectedDate);
    this.clockInterval = window.setInterval(this.updateClock, 60 * 1000);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.requestAnimationFrame(this.scrollToRelevantTime);
  }

  componentWillUnmount() {
    this.eventSubscription?.dispose();
    if (this.clockInterval) window.clearInterval(this.clockInterval);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private updateClock = () => {
    const now = moment();

    if (shouldAdvanceSelectedDate(this.state.selectedDate, this.state.now, now)) {
      const selectedDate = now.clone().startOf('day');
      this.setState({ now, selectedDate }, () => {
        this.subscribeToDate(selectedDate);
        window.requestAnimationFrame(this.scrollToRelevantTime);
      });
      return;
    }

    this.setState({ now });
  };

  private onVisibilityChange = () => {
    if (!document.hidden) this.updateClock();
  };

  private subscribeToDate(date: Moment, mode: SidebarMode = this.state.mode) {
    this.eventSubscription?.dispose();
    try {
      const startUnix = date.clone().startOf('day').unix();
      const endUnix =
        mode === 'agenda'
          ? date.clone().add(AGENDA_MONTHS_IN_VIEW, 'months').endOf('day').unix()
          : date.clone().endOf('day').unix();
      const disabledCalendars = AppEnv.config.get('mailspring.disabledCalendars') || [];
      this.dataSource.buildObservable({ startUnix, endUnix, disabledCalendars });
      this.eventSubscription = this.dataSource.subscribe(({ events }) => {
        this.setState({
          events: events.filter((event) => !event.isCancelled).sort((a, b) => a.start - b.start),
        });
      });
    } catch (error) {
      // The sidebar itself remains useful when the local calendar schema is
      // unavailable or still initializing. The main calendar can retry later.
      console.error('Unable to load compact calendar events', error);
      this.setState({ events: [] });
    }
  }

  private selectDate = (selectedDate: Moment) => {
    const next = selectedDate.clone().startOf('day');
    this.setState({ selectedDate: next });
    this.subscribeToDate(next);
    window.requestAnimationFrame(this.scrollToRelevantTime);
  };

  private selectMode = (mode: SidebarMode) => {
    this.setState({ mode }, () => {
      this.subscribeToDate(this.state.selectedDate, mode);
      if (mode === 'day') window.requestAnimationFrame(this.scrollToRelevantTime);
    });
  };

  private scrollToRelevantTime = () => {
    if (!this.hoursScroll) return;
    const hour = this.state.selectedDate.isSame(moment(), 'day') ? moment().hours() : 8;
    this.hoursScroll.scrollTop = Math.max(0, (hour - 8 - 1.5) * 54);
  };

  private openCalendar = (event?: EventOccurrence) => {
    Actions.selectRootSheet(WorkspaceStore.Sheet.Calendar);
    if (event) {
      window.setTimeout(() => Actions.focusCalendarEvent(event), 50);
    }
  };

  private createEvent = () => {
    this.openCalendar();
    window.setTimeout(() => AppEnv.commands.dispatch('core:add-item'), 75);
  };

  private renderAgenda() {
    const { events, selectedDate } = this.state;
    if (!events.length) {
      return (
        <div className="compact-calendar-empty">
          <Icon name="calendar" />
          <span>{localized('No upcoming events')}</span>
          <small>{localized('Nothing scheduled in the next six months.')}</small>
        </div>
      );
    }

    const eventsByDay = events.reduce(
      (groups, event) => {
        const day = moment.unix(Math.max(event.start, selectedDate.unix())).startOf('day');
        const key = day.format('YYYY-MM-DD');
        const group = groups.find((candidate) => candidate.key === key);
        if (group) {
          group.events.push(event);
        } else {
          groups.push({ key, day, events: [event] });
        }
        return groups;
      },
      [] as Array<{ key: string; day: Moment; events: EventOccurrence[] }>
    );

    return (
      <div className="compact-calendar-agenda">
        {eventsByDay.map(({ key, day, events: dayEvents }) => (
          <section className="compact-agenda-day" key={key}>
            <div className="compact-agenda-day-heading">
              <strong>
                {day.isSame(moment(), 'day') ? localized('Today') : day.format('dddd')}
              </strong>
              <span>{day.format('MMMM D, YYYY')}</span>
            </div>
            {dayEvents.map((event) => (
              <button
                key={event.id}
                type="button"
                className="compact-agenda-event"
                onClick={() => this.openCalendar(event)}
              >
                <span
                  className="compact-event-dot"
                  style={{ backgroundColor: calcEventColors(event.calendarId).band }}
                />
                <span className="compact-agenda-time">
                  {event.isAllDay ? localized('All day') : moment.unix(event.start).format('LT')}
                </span>
                <span className="compact-agenda-copy">
                  <strong>{event.title || localized('Untitled event')}</strong>
                  {event.location && <small>{event.location}</small>}
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
    );
  }

  private renderDay() {
    const { events, now, selectedDate } = this.state;
    const allDay = events.filter((event) => event.isAllDay);
    const timed = events.filter((event) => !event.isAllDay);
    const startHour = 8;
    const endHour = 24;
    const hourHeight = 54;
    const minutesInView = (endHour - startHour) * 60;
    const isToday = selectedDate.isSame(now, 'day');
    const nowMinutes = now.hours() * 60 + now.minutes() - startHour * 60;

    return (
      <div className="compact-day-view">
        <div className="compact-all-day-row">
          <span>{localized('All-day')}</span>
          <div>
            {allDay.map((event) => {
              const colors = calcEventColors(event.calendarId);
              return (
                <button
                  key={event.id}
                  type="button"
                  style={{
                    borderLeftColor: colors.band,
                    backgroundColor: colors.background,
                    color: colors.text,
                  }}
                  onClick={() => this.openCalendar(event)}
                >
                  {event.title}
                </button>
              );
            })}
          </div>
        </div>
        <div className="compact-hours-scroll" ref={(node) => (this.hoursScroll = node)}>
          <div className="compact-hours" style={{ height: (endHour - startHour) * hourHeight }}>
            {Array.from({ length: endHour - startHour }, (_, index) => {
              const hour = startHour + index;
              return (
                <div className="compact-hour" style={{ top: index * hourHeight }} key={hour}>
                  <span>{moment().hour(hour).minute(0).format('LT')}</span>
                </div>
              );
            })}
            {timed.map((event) => {
              const eventStart = moment.unix(event.start);
              const eventEnd = moment.unix(event.end);
              const colors = calcEventColors(event.calendarId);
              const startMinutes = Math.max(
                0,
                eventStart.hours() * 60 + eventStart.minutes() - startHour * 60
              );
              const duration = Math.max(
                24,
                Math.min(minutesInView - startMinutes, eventEnd.diff(eventStart, 'minutes'))
              );
              const eventHeight = Math.max(28, (duration / 60) * hourHeight);
              const isShortEvent = eventHeight < 38;
              return (
                <button
                  key={event.id}
                  type="button"
                  className={`compact-timed-event${isShortEvent ? ' is-short' : ''}`}
                  style={{
                    top: (startMinutes / 60) * hourHeight,
                    height: eventHeight,
                    borderLeftColor: colors.band,
                    backgroundColor: colors.background,
                    color: colors.text,
                  }}
                  onClick={() => this.openCalendar(event)}
                  title={event.title}
                >
                  <strong>{event.title || localized('Untitled event')}</strong>
                  <span>{eventStart.format('LT')}</span>
                </button>
              );
            })}
            {isToday && nowMinutes >= 0 && nowMinutes <= minutesInView && (
              <div className="compact-now-line" style={{ top: (nowMinutes / 60) * hourHeight }}>
                <span />
              </div>
            )}
            {!timed.length && (
              <div className="compact-day-empty">
                <Icon name="calendar" />
                <span>{localized('No events')}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  render() {
    const { selectedDate, mode, monthVisible } = this.state;
    return (
      <aside className="mail-calendar-sidebar" aria-label={localized('Calendar sidebar')}>
        <div className="compact-calendar-toolbar">
          <button
            type="button"
            className="compact-calendar-title"
            onClick={() => this.openCalendar()}
            title={localized('Open Calendar')}
          >
            <Icon name="calendar" />
            <span>
              {selectedDate.isSame(moment(), 'day')
                ? localized('Today')
                : selectedDate.format('ddd, MMM D')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => this.selectDate(selectedDate.clone().subtract(1, 'day'))}
            aria-label={localized('Previous day')}
          >
            <Icon name="chevron-left" />
          </button>
          <button type="button" className="today-button" onClick={() => this.selectDate(moment())}>
            {localized('Today')}
          </button>
          <button
            type="button"
            onClick={() => this.selectDate(selectedDate.clone().add(1, 'day'))}
            aria-label={localized('Next day')}
          >
            <Icon name="chevron-right" />
          </button>
          <button type="button" onClick={this.createEvent} aria-label={localized('New Event')}>
            <Icon name="plus" />
          </button>
        </div>
        <div className={`compact-month-wrap${monthVisible ? '' : ' collapsed'}`}>
          <button
            type="button"
            className="compact-month-toggle"
            onClick={() => this.setState({ monthVisible: !monthVisible })}
            aria-label={localized('Toggle month')}
          >
            <Icon name="up" />
          </button>
          {monthVisible && <MiniMonthView value={selectedDate} onChange={this.selectDate} />}
        </div>
        <div className="compact-calendar-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'day'}
            className={mode === 'day' ? 'active' : ''}
            onClick={() => this.selectMode('day')}
          >
            {localized('Day')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'agenda'}
            className={mode === 'agenda' ? 'active' : ''}
            onClick={() => this.selectMode('agenda')}
          >
            {localized('Agenda')}
          </button>
        </div>
        <div className="compact-calendar-content">
          {mode === 'day' ? this.renderDay() : this.renderAgenda()}
        </div>
      </aside>
    );
  }
}
