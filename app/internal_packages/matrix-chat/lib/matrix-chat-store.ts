import {
  Actions,
  KeyManager,
  NativeNotifications,
  WorkspaceStore,
  localized,
} from 'summermail-exports';
import SummerMailStore from 'summermail-store';
import {
  ClientEvent,
  EventStatus,
  EventType,
  MatrixClient,
  MatrixEvent,
  MsgType,
  NotificationCountType,
  RelationType,
  Room,
  RoomEvent,
} from 'matrix-js-sdk';
import {
  CryptoEvent,
  ShowSasCallbacks,
  VerificationPhase,
  VerificationRequest,
  VerificationRequestEvent,
  Verifier,
  VerifierEvent,
} from 'matrix-js-sdk/lib/crypto-api';
import {
  MatrixSessionCredentials,
  createMatrixClient,
  formatLoginError,
  loginToMatrix,
  clearMatrixLocalStores,
} from './matrix-session';
import groupMeBridge from './groupme-bridge';

const SESSION_CONFIG_KEY = 'matrix-chat.session';
const SESSION_SECRET_KEY = 'matrix-chat-session';
const MAX_UNREAD_COUNT = 9999;

export type MatrixConnectionState = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'error';

export interface MatrixVerificationState {
  deviceId: string | null;
  emojis: Array<{ emoji: string; name: string }>;
  otherDeviceId: string | null;
  initiatedByMe: boolean;
  phase: 'incoming' | 'waiting' | 'comparing' | 'working';
  userId: string;
}

export interface MatrixRoomSummary {
  encrypted: boolean;
  id: string;
  isDirect: boolean;
  lastActivity: number;
  lastMessage: string;
  name: string;
  presence: 'online' | 'unavailable' | 'offline' | null;
  unreadCount: number;
}

export interface MatrixTimelineItem {
  body: string;
  encrypted: boolean;
  eventId: string;
  failed?: boolean;
  pending?: boolean;
  own: boolean;
  reactions: MatrixReaction[];
  replyTo?: { body: string; eventId: string; senderName: string };
  senderId: string;
  senderName: string;
  timestamp: number;
  undecrypted?: boolean;
  kind?: 'message' | 'notice';
}

export interface MatrixReaction {
  count: number;
  key: string;
  mine: boolean;
}

export interface MatrixMemberSummary {
  id: string;
  name: string;
  presence: 'online' | 'unavailable' | 'offline' | null;
  status: string;
}

interface StoredSession {
  baseUrl: string;
  deviceId: string;
  userId: string;
}

function roomUnreadCount(room: Room): number {
  const highlight = room.getUnreadNotificationCount(NotificationCountType.Highlight) || 0;
  const total = room.getUnreadNotificationCount(NotificationCountType.Total) || 0;
  return Math.max(highlight, total, room.getUnreadNotificationCount() || 0);
}

function eventBody(event: MatrixEvent | null | undefined): string {
  if (!event) return '';
  if (event.isRedacted()) return localized('Message removed');
  if (event.isDecryptionFailure()) return localized('Unable to decrypt this message');
  const type = event.getType();
  if (type === EventType.RoomMessageEncrypted) {
    return localized('Encrypted message');
  }
  if (type === EventType.RoomMember) return membershipNotice(event);
  if (type !== EventType.RoomMessage && type !== EventType.Sticker) return '';
  const content = event.getContent() || {};
  if (content.msgtype === MsgType.Image) return localized('Image');
  if (content.msgtype === MsgType.File) return localized('File');
  if (content.msgtype === MsgType.Audio) return localized('Audio');
  if (content.msgtype === MsgType.Video) return localized('Video');
  if (content.msgtype === MsgType.Emote) {
    return '*' + String(content.body || '').trim();
  }
  return String(content.body || content.formatted_body || '').trim();
}

function membershipNotice(event: MatrixEvent): string {
  const content = event.getContent() || {};
  const prev = event.getPrevContent?.() || {};
  const name = String(
    content.displayname || event.sender?.name || event.getSender() || localized('Someone')
  );
  if (content.membership === 'join' && prev.membership !== 'join') {
    return localized('%@ joined the room', name);
  }
  if (content.membership === 'leave' && prev.membership === 'join') {
    return localized('%@ left the room', name);
  }
  if (content.displayname && prev.displayname && content.displayname !== prev.displayname) {
    return localized('%@ changed their display name to %@', prev.displayname, content.displayname);
  }
  return '';
}

function isNoticeEvent(event: MatrixEvent): boolean {
  return event.getType() === EventType.RoomMember;
}

function latestVisibleEvent(room: Room): MatrixEvent | null {
  const events = room.getLiveTimeline().getEvents();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!eventBody(event) || isNoticeEvent(event)) continue;
    return event;
  }
  return null;
}

function summarizeRoom(room: Room): MatrixRoomSummary {
  const last = latestVisibleEvent(room);
  const members = room.getJoinedMembers();
  const isDirect = members.length <= 2;
  const other = isDirect
    ? members.find((member) => member.userId !== room.client?.getUserId?.()) || members[0]
    : null;
  return {
    encrypted: room.hasEncryptionStateEvent(),
    id: room.roomId,
    isDirect,
    lastActivity: last?.getTs() || room.getLastActiveTimestamp() || 0,
    lastMessage: eventBody(last),
    name: room.name || room.roomId,
    presence: normalizePresence(other?.user?.presence),
    unreadCount: roomUnreadCount(room),
  };
}

function senderName(room: Room | null, event: MatrixEvent): string {
  const member = room?.getMember(event.getSender() || '');
  return member?.name || event.sender?.name || event.getSender() || localized('Unknown');
}

function normalizePresence(value?: string | null): 'online' | 'unavailable' | 'offline' | null {
  if (value === 'online' || value === 'unavailable' || value === 'offline') return value;
  return null;
}

function eventReactions(room: Room, event: MatrixEvent, userId: string): MatrixReaction[] {
  const counts: Record<string, { count: number; mine: boolean }> = {};
  for (const candidate of room.getLiveTimeline().getEvents()) {
    if (candidate.getType() !== EventType.Reaction || candidate.isRedacted()) continue;
    const relation = candidate.getRelation();
    if (relation?.rel_type !== RelationType.Annotation || relation.event_id !== event.getId()) {
      continue;
    }
    const key = String(relation.key || '');
    if (!key) continue;
    counts[key] = counts[key] || { count: 0, mine: false };
    counts[key].count += 1;
    if (candidate.getSender() === userId) counts[key].mine = true;
  }
  return Object.entries(counts).map(([key, value]) => ({ key, ...value }));
}

function replyPreview(room: Room, event: MatrixEvent): MatrixTimelineItem['replyTo'] {
  const relatedId = event.getWireContent()?.['m.relates_to']?.['m.in_reply_to']?.event_id;
  if (!relatedId) return undefined;
  const related = room.findEventById(relatedId);
  if (!related) return { body: localized('Original message'), eventId: relatedId, senderName: '' };
  return {
    body: eventBody(related) || localized('Original message'),
    eventId: relatedId,
    senderName: senderName(room, related),
  };
}

export class MatrixChatStoreClass extends SummerMailStore {
  private _client: MatrixClient | null = null;
  private _composerDraft = '';
  private _connectionState: MatrixConnectionState = 'idle';
  private _error: string | null = null;
  private _members: MatrixMemberSummary[] = [];
  private _replyTo: MatrixTimelineItem | null = null;
  private _restoring = false;
  private _rooms: MatrixRoomSummary[] = [];
  private _searchQuery = '';
  private _selectedRoomId: string | null = null;
  private _sending = false;
  private _timeline: MatrixTimelineItem[] = [];
  private _userId: string | null = null;
  private _verification: MatrixVerificationState | null = null;
  private _verificationRequest: VerificationRequest | null = null;
  private _sas: ShowSasCallbacks | null = null;
  private _startingSas = false;
  private _deviceVerified = false;

  constructor() {
    super();
    void this.restoreSession();
  }

  composerDraft() {
    return this._composerDraft;
  }

  members() {
    return this._members;
  }

  replyTo() {
    return this._replyTo;
  }

  searchQuery() {
    return this._searchQuery;
  }

  connectionState() {
    return this._connectionState;
  }

  error() {
    return this._error;
  }

  isLoggedIn() {
    return !!this._client;
  }

  restoring() {
    return this._restoring;
  }

  rooms() {
    return this._rooms;
  }

  selectedRoom() {
    return this._rooms.find((room) => room.id === this._selectedRoomId) || null;
  }

  selectedRoomId() {
    return this._selectedRoomId;
  }

  sending() {
    return this._sending;
  }

  timeline() {
    return this._timeline;
  }

  unreadCount() {
    const total = this._rooms.reduce((sum, room) => sum + (room.unreadCount > 0 ? 1 : 0), 0);
    return Math.min(total, MAX_UNREAD_COUNT);
  }

  userId() {
    return this._userId;
  }

  verification() {
    return this._verification;
  }

  isDeviceVerified() {
    return this._deviceVerified;
  }

  setComposerDraft(value: string) {
    if (this._composerDraft === value) return;
    this._composerDraft = value;
    this.trigger(this);
  }

  async login(login: string, password: string, homeserver?: string) {
    this._connectionState = 'connecting';
    this._error = null;
    this.trigger(this);
    try {
      const { client, credentials } = await loginToMatrix(login, password, homeserver);
      await this._persistSession(credentials);
      await this._attachClient(client, credentials.userId);
    } catch (error) {
      this._connectionState = 'error';
      this._error = formatLoginError(error);
      this.trigger(this);
      throw error;
    }
  }

  async logout() {
    const client = this._client;
    this._client = null;
    this._composerDraft = '';
    this._connectionState = 'idle';
    this._error = null;
    this._members = [];
    this._replyTo = null;
    this._rooms = [];
    this._searchQuery = '';
    this._selectedRoomId = null;
    this._timeline = [];
    this._userId = null;
    this._clearVerification();
    this._deviceVerified = false;
    AppEnv.config.set(SESSION_CONFIG_KEY, null);
    await KeyManager.deletePassword(SESSION_SECRET_KEY);
    this.trigger(this);
    if (!client) return;
    try {
      client.stopClient();
      await client.logout(true);
      await client.clearStores();
    } catch {
      // Keep local logout even if the homeserver call fails.
    }
    await clearMatrixLocalStores();
    groupMeBridge.attachMatrixClient(null);
  }

  selectRoom(roomId: string) {
    if (this._selectedRoomId === roomId) return;
    this._selectedRoomId = roomId;
    this._composerDraft = '';
    this._replyTo = null;
    this._refreshTimeline();
    this._refreshMembers();
    this.trigger(this);
    void this.markSelectedRoomRead();
  }

  async markSelectedRoomRead() {
    const client = this._client;
    const room = this._selectedRoom();
    if (!client || !room) return;
    const last = latestVisibleEvent(room);
    if (!last) return;
    try {
      await client.sendReadReceipt(last);
      this._refreshRooms();
      this.trigger(this);
    } catch {
      // Receipts are best-effort; keep the conversation usable.
    }
  }

  async sendMessage() {
    const client = this._client;
    const roomId = this._selectedRoomId;
    const body = this._composerDraft.trim();
    if (!client || !roomId || !body || this._sending) return;
    this._sending = true;
    this._composerDraft = '';
    this.trigger(this);
    try {
      if (this._replyTo) {
        await client.sendEvent(roomId, EventType.RoomMessage, {
          msgtype: MsgType.Text,
          body,
          'm.relates_to': {
            'm.in_reply_to': { event_id: this._replyTo.eventId },
          },
        });
      } else {
        await client.sendTextMessage(roomId, body);
      }
      const sent = this._selectedRoom()?.getLiveTimeline().getEvents().slice(-1)[0]?.getId();
      await groupMeBridge.handleOutgoingMatrixMessage(roomId, body, sent);
      this._replyTo = null;
      this._refreshTimeline();
      this._refreshRooms();
    } catch (error) {
      this._error = formatLoginError(error);
      this._composerDraft = body;
    } finally {
      this._sending = false;
      this.trigger(this);
    }
  }

  setSearchQuery(value: string) {
    if (this._searchQuery === value) return;
    this._searchQuery = value;
    this.trigger(this);
  }

  setReplyTo(item: MatrixTimelineItem | null) {
    this._replyTo = item;
    this.trigger(this);
  }

  async toggleReaction(eventId: string, key: string) {
    const client = this._client;
    const room = this._selectedRoom();
    if (!client || !room || !this._userId) return;
    const existing = room
      .getLiveTimeline()
      .getEvents()
      .find((candidate) => {
        const relation = candidate.getRelation();
        return (
          candidate.getType() === EventType.Reaction &&
          candidate.getSender() === this._userId &&
          relation?.rel_type === RelationType.Annotation &&
          relation.event_id === eventId &&
          relation.key === key &&
          !candidate.isRedacted()
        );
      });
    try {
      const existingId = existing?.getId();
      if (existingId) {
        await client.redactEvent(room.roomId, existingId);
      } else {
        await client.sendEvent(room.roomId, EventType.Reaction, {
          'm.relates_to': {
            rel_type: RelationType.Annotation,
            event_id: eventId,
            key,
          },
        });
      }
      this._refreshTimeline();
      this.trigger(this);
    } catch (error) {
      this._error = formatLoginError(error);
      this.trigger(this);
    }
  }

  private async restoreSession() {
    const stored = AppEnv.config.get(SESSION_CONFIG_KEY) as StoredSession | null;
    if (!stored?.userId || !stored.baseUrl || !stored.deviceId) return;
    this._restoring = true;
    this._connectionState = 'connecting';
    this.trigger(this);
    try {
      const accessToken = await KeyManager.getPassword(SESSION_SECRET_KEY);
      if (!accessToken) {
        throw new Error(localized('Saved Matrix login could not be read.'));
      }
      const client = await createMatrixClient({
        accessToken,
        baseUrl: stored.baseUrl,
        deviceId: stored.deviceId,
        userId: stored.userId,
      });
      await this._attachClient(client, stored.userId);
    } catch (error) {
      this._connectionState = 'error';
      this._error = formatLoginError(error);
      this._restoring = false;
      this.trigger(this);
    }
  }

  private async _persistSession(credentials: MatrixSessionCredentials) {
    AppEnv.config.set(SESSION_CONFIG_KEY, {
      baseUrl: credentials.baseUrl,
      deviceId: credentials.deviceId,
      userId: credentials.userId,
    } satisfies StoredSession);
    await KeyManager.replacePassword(SESSION_SECRET_KEY, credentials.accessToken);
  }

  private async _attachClient(client: MatrixClient, userId: string) {
    this._unbindClient();
    this._client = client;
    this._userId = userId;
    this._restoring = false;
    this._error = null;
    this._connectionState = 'connecting';
    client.on(ClientEvent.Sync, this._onSync);
    client.on(RoomEvent.Timeline, this._onTimeline);
    client.on(RoomEvent.Name, this._onRoomsChanged);
    client.on(CryptoEvent.VerificationRequestReceived, this._onVerificationRequest);
    await client.startClient({ initialSyncLimit: 30, lazyLoadMembers: true });
    groupMeBridge.attachMatrixClient(client);
    void groupMeBridge.restore();
    await this._refreshDeviceVerified();
    this._refreshRooms();
    this.trigger(this);
  }

  private _unbindClient() {
    const client = this._client;
    if (!client) return;
    client.removeListener(ClientEvent.Sync, this._onSync);
    client.removeListener(RoomEvent.Timeline, this._onTimeline);
    client.removeListener(RoomEvent.Name, this._onRoomsChanged);
    client.removeListener(CryptoEvent.VerificationRequestReceived, this._onVerificationRequest);
    client.stopClient();
  }

  private _onSync = (state: string) => {
    if (state === 'PREPARED' || state === 'SYNCING') {
      this._connectionState = 'ready';
      this._error = null;
    } else if (state === 'RECONNECTING' || state === 'CATCHUP') {
      this._connectionState = 'reconnecting';
    } else if (state === 'ERROR') {
      this._connectionState = 'error';
      this._error = localized('Lost the connection to Matrix. Retrying…');
    } else if (state === 'STOPPED') {
      this._connectionState = 'idle';
    }
    this._refreshRooms();
    this.trigger(this);
  };

  private async _refreshDeviceVerified() {
    const client = this._client;
    const crypto = client?.getCrypto();
    const userId = this._userId || client?.getUserId();
    const deviceId = client?.getDeviceId();
    if (!crypto || !userId || !deviceId) {
      this._deviceVerified = false;
      return;
    }
    try {
      const status = await crypto.getDeviceVerificationStatus(userId, deviceId);
      this._deviceVerified = !!(
        status?.isVerified() ||
        status?.crossSigningVerified ||
        status?.signedByOwner
      );
    } catch {
      this._deviceVerified = false;
    }
  }

  private _onRoomsChanged = () => {
    this._refreshRooms();
    this.trigger(this);
  };

  async startDeviceVerification() {
    const crypto = this._client?.getCrypto();
    if (!crypto) {
      this._error = localized('Encryption is not ready on this device yet.');
      this.trigger(this);
      return;
    }
    const request = await crypto.requestOwnUserVerification();
    await this._bindVerificationRequest(request);
    await this._maybeStartSas(request);
  }

  async acceptVerification() {
    const request = this._verificationRequest;
    if (!request || request.initiatedByMe) return;
    await request.accept();
    await this._maybeStartSas(request);
  }

  async confirmVerification() {
    if (!this._sas) return;
    await this._sas.confirm();
    this._syncVerificationState();
  }

  async cancelVerification() {
    this._sas?.mismatch?.();
    await this._verificationRequest?.cancel();
    this._clearVerification();
    this.trigger(this);
  }

  private _onVerificationRequest = (request: VerificationRequest) => {
    void this._bindVerificationRequest(request);
  };

  private async _bindVerificationRequest(request: VerificationRequest) {
    this._verificationRequest?.off(VerificationRequestEvent.Change, this._onVerificationChange);
    this._verificationRequest = request;
    request.on(VerificationRequestEvent.Change, this._onVerificationChange);
    this._syncVerificationState();
    await this._maybeStartSas(request);
  }

  private async _maybeStartSas(request?: VerificationRequest | null) {
    if (!request || this._startingSas) return;
    if (request.verifier) {
      this._bindVerifier(request.verifier);
      void request.verifier.verify().catch(() => {});
      return;
    }
    if (request.phase !== VerificationPhase.Ready && request.phase !== VerificationPhase.Started) {
      return;
    }
    this._startingSas = true;
    try {
      const verifier = await request.startVerification('m.sas.v1');
      this._bindVerifier(verifier);
      void verifier.verify().catch(() => {});
    } catch {
      // The other device may already have chosen a method.
    } finally {
      this._startingSas = false;
      this._syncVerificationState();
    }
  }

  private _bindVerifier(verifier: Verifier) {
    verifier.off(VerifierEvent.ShowSas, this._onShowSas);
    verifier.on(VerifierEvent.ShowSas, this._onShowSas);
    const existing = verifier.getShowSasCallbacks();
    if (existing) this._onShowSas(existing);
  }

  private _onShowSas = (sas: ShowSasCallbacks) => {
    this._sas = sas;
    this._syncVerificationState();
  };

  private _onVerificationChange = () => {
    const request = this._verificationRequest;
    if (request?.verifier) this._bindVerifier(request.verifier);
    void this._maybeStartSas(request);
    if (
      request?.phase === VerificationPhase.Done ||
      request?.phase === VerificationPhase.Cancelled
    ) {
      const done = request.phase === VerificationPhase.Done;
      this._clearVerification();
      if (done) {
        this._error = null;
        void this._restoreKeysAfterVerification();
        void this._refreshDeviceVerified().then(() => this.trigger(this));
      } else {
        this._error = localized(
          'Verification timed out or was cancelled. Start it again, then accept on the other device before it expires.'
        );
      }
      this.trigger(this);
      return;
    }
    this._syncVerificationState();
  };

  private _syncVerificationState() {
    const request = this._verificationRequest;
    if (!request) {
      this._verification = null;
      this.trigger(this);
      return;
    }
    const emojis = (this._sas?.sas.emoji || []).map(([emoji, name]) => ({ emoji, name }));
    let phase: MatrixVerificationState['phase'] = 'working';
    if (emojis.length) {
      phase = 'comparing';
    } else if (!request.initiatedByMe && request.phase === VerificationPhase.Requested) {
      phase = 'incoming';
    } else if (request.initiatedByMe) {
      phase = 'waiting';
    }
    this._verification = {
      deviceId: this._client?.getDeviceId() || null,
      emojis,
      initiatedByMe: request.initiatedByMe,
      otherDeviceId: request.otherDeviceId || null,
      phase,
      userId: request.otherUserId,
    };
    this.trigger(this);
  }

  private _clearVerification() {
    this._verificationRequest?.off(VerificationRequestEvent.Change, this._onVerificationChange);
    this._verificationRequest = null;
    this._sas = null;
    this._verification = null;
    this._startingSas = false;
  }

  private async _restoreKeysAfterVerification() {
    const crypto = this._client?.getCrypto();
    if (!crypto) return;
    try {
      await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
      await crypto.restoreKeyBackup();
      this._refreshTimeline();
      this._refreshRooms();
      await this._refreshDeviceVerified();
      this.trigger(this);
    } catch {
      // Verification still helps future messages even if backup restore is unavailable.
    }
  }

  private _onTimeline = (event: MatrixEvent, room?: Room, toStartOfTimeline?: boolean) => {
    if (toStartOfTimeline || !room) return;
    this._refreshRooms();
    if (room.roomId === this._selectedRoomId) {
      this._refreshTimeline();
      void this.markSelectedRoomRead();
    } else {
      this._notifyIfNeeded(event, room);
    }
    this.trigger(this);
  };

  private _notifyIfNeeded(event: MatrixEvent, room: Room) {
    if (!this._client) return;
    if (event.getSender() === this._userId) return;
    const body = eventBody(event);
    if (!body) return;
    if (roomUnreadCount(room) <= 0) return;
    if (WorkspaceStore.rootSheet()?.id === 'Matrix' && this._selectedRoomId === room.roomId) {
      return;
    }
    void NativeNotifications.displayNotification({
      title: room.name || localized('Chat'),
      subtitle: senderName(room, event),
      body,
      tag: room.roomId,
      onActivate: () => {
        this.selectRoom(room.roomId);
        if (WorkspaceStore.Sheet.Matrix) {
          Actions.selectRootSheet(WorkspaceStore.Sheet.Matrix);
        }
      },
    });
  }

  private _selectedRoom(): Room | null {
    if (!this._client || !this._selectedRoomId) return null;
    return this._client.getRoom(this._selectedRoomId);
  }

  private _refreshRooms() {
    if (!this._client) {
      this._rooms = [];
      return;
    }
    this._rooms = this._client
      .getVisibleRooms()
      .map(summarizeRoom)
      .sort((a, b) => {
        if (a.unreadCount && !b.unreadCount) return -1;
        if (!a.unreadCount && b.unreadCount) return 1;
        return b.lastActivity - a.lastActivity;
      });
    if (!this._selectedRoomId && this._rooms[0]) {
      this._selectedRoomId = this._rooms[0].id;
      this._refreshTimeline();
      this._refreshMembers();
    }
  }

  private _refreshMembers() {
    const room = this._selectedRoom();
    if (!room) {
      this._members = [];
      return;
    }
    this._members = room
      .getJoinedMembers()
      .map((member) => ({
        id: member.userId,
        name: member.name || member.userId,
        presence: normalizePresence(member.user?.presence),
        status: String(member.user?.presenceStatusMsg || '').trim(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private _refreshTimeline() {
    const room = this._selectedRoom();
    if (!room || !this._userId) {
      this._timeline = [];
      return;
    }
    this._timeline = room
      .getLiveTimeline()
      .getEvents()
      .map((event) => {
        const body = eventBody(event);
        if (!body) return null;
        return {
          body,
          encrypted: event.isEncrypted(),
          eventId: event.getId() || String(event.getTs()) + '-' + String(event.getSender() || ''),
          failed: event.status === EventStatus.NOT_SENT,
          pending: event.status === EventStatus.SENDING || event.isSending(),
          own: event.getSender() === this._userId,
          reactions: eventReactions(room, event, this._userId),
          replyTo: replyPreview(room, event),
          senderId: event.getSender() || '',
          senderName: senderName(room, event),
          timestamp: event.getTs(),
          undecrypted: event.isDecryptionFailure(),
          kind: isNoticeEvent(event) ? 'notice' : 'message',
        } as MatrixTimelineItem;
      })
      .filter(Boolean) as MatrixTimelineItem[];
  }
}

const MatrixChatStore = new MatrixChatStoreClass();
export default MatrixChatStore;
