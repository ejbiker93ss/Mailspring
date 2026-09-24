import React from 'react';
import ReactDOM from 'react-dom';
import { AccountStore, Actions, Calendar, DatabaseStore, localized } from 'summermail-exports';
import { RetinaImg, BindGlobalCommands } from 'summermail-component-kit';
import { CalendarEventPopover } from './core/calendar-event-popover';
import { EventOccurrence } from './core/calendar-data-source';
import { getEditableCalendars, showNoEditableCalendarsError } from './core/calendar-helpers';

export class QuickEventButton extends React.Component<Record<string, unknown>> {
  static displayName = 'QuickEventButton';

  _openPopover = async () => {
    const el = ReactDOM.findDOMNode(this) as HTMLElement;
    if (!el) return;
    const calendars = await DatabaseStore.findAll<Calendar>(Calendar);
    const disabledCalendars: string[] = AppEnv.config.get('summermail.disabledCalendars') || [];
    const editableCalendars = getEditableCalendars(calendars, disabledCalendars);
    if (!editableCalendars.length) {
      showNoEditableCalendarsError();
      return;
    }

    const start = Math.ceil(Date.now() / 1000 / 1800) * 1800;
    const defaultCalendar = editableCalendars[0];
    const event: EventOccurrence = {
      id: `__new_event_${Date.now()}`,
      start,
      end: start + 3600,
      title: '',
      description: '',
      location: '',
      isAllDay: false,
      isRecurring: false,
      isCancelled: false,
      isPending: false,
      isException: false,
      organizer: null,
      attendees: [],
      accountId: defaultCalendar.accountId,
      calendarId: defaultCalendar.id,
    };
    const buttonRect = el.getBoundingClientRect();
    Actions.openPopover(
      <CalendarEventPopover
        event={event}
        isNewEvent
        calendars={calendars}
        accounts={AccountStore.accounts()}
        disabledCalendars={disabledCalendars}
      />,
      {
        originRect: buttonRect,
        direction: 'down',
        fallbackDirection: 'left',
        closeOnAppBlur: false,
      }
    );
  };

  onClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    this._openPopover();
  };

  render() {
    return (
      <BindGlobalCommands commands={{ 'core:add-item': this._openPopover }}>
        <button
          style={{ order: -50 }}
          tabIndex={-1}
          className="btn btn-toolbar item-compose"
          title={localized('Create new event')}
          aria-label={localized('Create new event')}
          onClick={this.onClick}
        >
          <RetinaImg
            name="toolbar-compose.png"
            mode={RetinaImg.Mode.ContentIsMask}
            aria-hidden="true"
          />
        </button>
      </BindGlobalCommands>
    );
  }
}
