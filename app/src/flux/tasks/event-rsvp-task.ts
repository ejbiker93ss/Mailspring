import { Task } from './task';
import { AttributeValues } from '../models/model';
import * as Attributes from '../attributes';
import {
  localized,
  ICSParticipantStatus,
  SyncbackMetadataTask,
  CalendarUtils,
  Calendar,
  DatabaseStore,
  Event,
  Message,
  Actions,
  SyncbackEventTask,
} from 'summermail-exports';

export class EventRSVPTask extends Task {
  ics: string;
  icsRSVPStatus: ICSParticipantStatus;
  subject: string;
  messageId: string;
  organizerEmail: string;
  icsOriginalData: string;

  static attributes = {
    ...Task.attributes,

    ics: Attributes.String({
      modelKey: 'ics',
    }),
    icsRSVPStatus: Attributes.String({
      modelKey: 'icsRSVPStatus',
    }),
    icsOriginalData: Attributes.String({
      modelKey: 'icsOriginalData',
    }),
    to: Attributes.String({
      modelKey: 'to',
    }),
    subject: Attributes.String({
      modelKey: 'subject',
    }),
    messageId: Attributes.String({
      modelKey: 'messageId',
    }),
  };

  constructor(data: AttributeValues<typeof EventRSVPTask.attributes> = {}) {
    super(data);
  }

  static forReplying({
    accountId,
    to,
    messageId,
    icsOriginalData,
    icsRSVPStatus,
  }: {
    to: string;
    accountId: string;
    messageId?: string;
    icsOriginalData: string;
    icsRSVPStatus: ICSParticipantStatus;
  }) {
    const { event, root } = CalendarUtils.parseICSString(icsOriginalData);
    const me = CalendarUtils.selfParticipant(event, accountId);
    if (!me) {
      throw new Error(
        `EventRSVPTask.forReplying: could not find an attendee matching account ${accountId} in this event's ICS data.`
      );
    }

    // Update the replying attendee's participation status
    me.component.setParameter('partstat', icsRSVPStatus);

    // Set METHOD to REPLY at the calendar level
    root.updatePropertyWithValue('method', 'REPLY');

    // Per RFC 5546, a REPLY must have exactly one ATTENDEE - the replying user.
    // Remove all other attendees from the VEVENT, keeping only the self-participant.
    const vevent = root.getFirstSubcomponent('vevent');
    const allAttendees = vevent.getAllProperties('attendee');
    for (const attendee of allAttendees) {
      if (attendee !== me.component) {
        vevent.removeProperty(attendee);
      }
    }

    const icsReplyData = root.toString();

    return new EventRSVPTask({
      to,
      subject: `${icsRSVPStatus[0].toUpperCase()}${icsRSVPStatus.substr(1).toLowerCase()}: ${
        event.summary
      }`,
      accountId,
      messageId,
      ics: icsReplyData,
      icsOriginalData,
      icsRSVPStatus,
    });
  }

  label() {
    return localized('Sending RSVP');
  }

  /**
   * Keep an accepted invitation visible even when the provider does not add
   * inbound invitations to CalDAV, or when the post-RSVP calendar refresh is
   * temporarily unavailable. The normal syncback task still persists the
   * event remotely when the calendar connection is healthy.
   */
  async saveAcceptedEventToCalendar() {
    if (this.icsRSVPStatus !== 'ACCEPTED' || !this.icsOriginalData) return;

    const { root: invitationRoot, event: invitation } = CalendarUtils.parseICSString(
      this.icsOriginalData
    );
    if (!invitation.uid || !invitation.startDate) return;

    const existing = await DatabaseStore.findBy<Event>(Event, {
      icsuid: invitation.uid,
      accountId: this.accountId,
    });

    if (existing) {
      const { root, event } = CalendarUtils.parseICSString(existing.ics);
      const me = CalendarUtils.selfParticipant(event, this.accountId);
      if (!me || me.status === 'ACCEPTED') return;

      const updatedEvent = existing.clone();
      const undoData = {
        ics: existing.ics,
        recurrenceStart: existing.recurrenceStart,
        recurrenceEnd: existing.recurrenceEnd,
      };
      me.component.setParameter('partstat', 'ACCEPTED');
      updatedEvent.ics = root.toString();
      Actions.queueTask(
        SyncbackEventTask.forUpdating({
          event: updatedEvent,
          undoData,
          description: localized('Accept invitation'),
        })
      );
      return;
    }

    const calendars = (await DatabaseStore.findAll<Calendar>(Calendar))
      .filter((calendar) => calendar.accountId === this.accountId && !calendar.readOnly)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const calendar = calendars[0];
    if (!calendar) {
      console.warn('EventRSVPTask: No writable calendar is available for the accepted event.');
      return;
    }

    const me = CalendarUtils.selfParticipant(invitation, this.accountId);
    if (me) me.component.setParameter('partstat', 'ACCEPTED');
    invitationRoot.removeProperty('method');

    const start = invitation.startDate.toJSDate().getTime() / 1000;
    const end = (invitation.endDate || invitation.startDate).toJSDate().getTime() / 1000;
    const acceptedEvent = new Event({
      accountId: this.accountId,
      calendarId: calendar.id,
      ics: invitationRoot.toString(),
      icsuid: invitation.uid,
      recurrenceStart: start,
      recurrenceEnd: end,
    });

    Actions.queueTask(
      SyncbackEventTask.forCreating({
        event: acceptedEvent,
        calendarId: calendar.id,
        accountId: this.accountId,
      })
    );
  }

  async onSuccess() {
    if (this.messageId && this.icsRSVPStatus) {
      const msg = await DatabaseStore.find<Message>(Message, this.messageId);
      if (msg) {
        Actions.queueTask(
          SyncbackMetadataTask.forSaving({
            model: msg,
            pluginId: 'event-rsvp',
            value: {
              status: this.icsRSVPStatus,
              time: Date.now(),
            },
          })
        );
      }
    }

    await this.saveAcceptedEventToCalendar();

    // Pull the provider's latest calendar state after any RSVP response. Calendar
    // views observe the local Event table and update as soon as this sync lands.
    AppEnv.mailsyncBridge.sendSyncCalendarNow(this.accountId);
  }
}
