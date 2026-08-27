import React from 'react';
import ReactDOM from 'react-dom';
import ReactTestUtils from 'react-dom/test-utils';

import MTestUtils from '../../../spec/mailspring-test-utils';
import { CalendarEventPopoverUneditable } from '../lib/core/calendar-event-popover';
import { EventOccurrence } from '../lib/core/calendar-data-source';

function eventWithStatus(status?: string): EventOccurrence {
  return {
    id: 'event-1-e0',
    accountId: 'account-1',
    calendarId: 'calendar-1',
    start: 1787929200,
    end: 1787936400,
    title: 'Integration Design Review',
    description: '',
    location: '',
    isAllDay: false,
    isCancelled: false,
    isPending: status !== 'ACCEPTED' && status !== 'DECLINED',
    myParticipationStatus: status,
    myAttendeeEmail: status ? 'me@example.com' : undefined,
    isException: false,
    isRecurring: false,
    organizer: { email: 'organizer@example.com' },
    attendees: [
      { email: 'organizer@example.com', name: 'Organizer', partstat: 'ACCEPTED' },
      { email: 'me@example.com', name: 'Me', partstat: status || 'NEEDS-ACTION' },
    ],
  };
}

describe('CalendarEventPopover RSVP actions', () => {
  it('offers Accept, Maybe, and Decline for an attendee awaiting a response', () => {
    const onRSVP = jasmine.createSpy('onRSVP').andReturn(Promise.resolve());
    const component = MTestUtils.renderIntoDocument(
      <CalendarEventPopoverUneditable
        event={eventWithStatus('NEEDS-ACTION')}
        onEdit={() => {}}
        onRSVP={onRSVP}
      />
    ) as unknown as CalendarEventPopoverUneditable;
    const root = ReactDOM.findDOMNode(component) as HTMLElement;
    const buttons = Array.from(root.querySelectorAll('.event-rsvp-button')) as HTMLButtonElement[];

    expect(buttons.map((button) => button.textContent)).toEqual(['Accept', 'Maybe', 'Decline']);
    ReactTestUtils.Simulate.click(buttons[0]);
    expect(onRSVP).toHaveBeenCalledWith('ACCEPTED');
  });

  it('shows the current response as selected', () => {
    const component = MTestUtils.renderIntoDocument(
      <CalendarEventPopoverUneditable
        event={eventWithStatus('TENTATIVE')}
        onEdit={() => {}}
        onRSVP={() => Promise.resolve()}
      />
    ) as unknown as CalendarEventPopoverUneditable;
    const root = ReactDOM.findDOMNode(component) as HTMLElement;
    const selected = root.querySelector(
      '.event-rsvp-button[aria-pressed="true"]'
    ) as HTMLButtonElement;

    expect(selected.textContent).toBe('Maybe');
  });

  it('does not offer RSVP controls when the current user is not an attendee', () => {
    const component = MTestUtils.renderIntoDocument(
      <CalendarEventPopoverUneditable
        event={eventWithStatus(undefined)}
        onEdit={() => {}}
        onRSVP={() => Promise.resolve()}
      />
    ) as unknown as CalendarEventPopoverUneditable;
    const root = ReactDOM.findDOMNode(component) as HTMLElement;

    expect(root.querySelector('.event-rsvp-actions')).toBeNull();
  });
});
