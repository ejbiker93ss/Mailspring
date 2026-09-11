import {
  EventType,
  MatrixClient,
  MatrixEvent,
  MsgType,
  Preset,
  Room,
  RoomEvent,
  Visibility,
} from 'matrix-js-sdk';
import { KeyManager, localized } from 'summermail-exports';
import {
  GroupMeChat,
  GroupMeMessage,
  groupmeChats,
  groupmeMe,
  groupmeMessages,
  groupmeSend,
} from './groupme-client';

const TOKEN_KEY = 'groupme-access-token';
const STATE_KEY = 'matrix-chat.groupme';
const POLL_MS = 4000;
const ROOM_TOPIC_PREFIX = 'groupme:';
const PUPPET_EVENT = 'org.matrix.puppet.groupme';

interface BridgeMap {
  groupmeId: string;
  lastGroupmeId?: string;
  lastMatrixEventId?: string;
  matrixRoomId: string;
}

interface BridgeState {
  enabled: boolean;
  maps: BridgeMap[];
  userId?: string;
  userName?: string;
}

function emptyState(): BridgeState {
  return { enabled: false, maps: [] };
}

function readState(): BridgeState {
  const stored = AppEnv.config.get(STATE_KEY) as BridgeState | null;
  if (!stored || typeof stored !== 'object') return emptyState();
  return {
    enabled: stored.enabled === true,
    maps: Array.isArray(stored.maps) ? stored.maps : [],
    userId: stored.userId,
    userName: stored.userName,
  };
}

function writeState(state: BridgeState) {
  AppEnv.config.set(STATE_KEY, state);
}

function topicFor(chat: GroupMeChat) {
  return `${ROOM_TOPIC_PREFIX}${chat.kind}:${chat.id}`;
}

export class GroupMeBridge {
  private chats: GroupMeChat[] = [];
  private client: MatrixClient | null = null;
  private error: string | null = null;
  private listeners = new Set<() => void>();
  private polling = false;
  private state = readState();
  private timer: number | null = null;
  private token: string | null = null;

  listen(callback: () => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  snapshot() {
    return {
      chats: this.chats,
      connected: !!this.token,
      enabled: this.state.enabled,
      error: this.error,
      maps: this.state.maps,
      userName: this.state.userName || null,
    };
  }

  attachMatrixClient(client: MatrixClient | null) {
    this.client?.removeListener(RoomEvent.Timeline, this._onMatrixTimeline);
    this.client = client;
    if (client) client.on(RoomEvent.Timeline, this._onMatrixTimeline);
    if (client && this.state.enabled) void this.start();
    else this.stopPolling();
    this.emit();
  }

  async connect(token: string) {
    const trimmed = token.trim();
    if (!trimmed) throw new Error(localized('Paste a GroupMe access token.'));
    const user = await groupmeMe(trimmed);
    await KeyManager.replacePassword(TOKEN_KEY, trimmed);
    this.token = trimmed;
    this.state = {
      ...this.state,
      enabled: true,
      userId: user.id,
      userName: user.name,
    };
    writeState(this.state);
    this.chats = await groupmeChats(trimmed);
    this.error = null;
    await this.start();
    this.emit();
  }

  async disconnect() {
    this.stopPolling();
    this.token = null;
    this.chats = [];
    this.state = { ...this.state, enabled: false };
    writeState(this.state);
    await KeyManager.deletePassword(TOKEN_KEY);
    this.emit();
  }

  async restore() {
    if (!this.state.enabled) return;
    this.token = (await KeyManager.getPassword(TOKEN_KEY)) || null;
    if (!this.token) {
      this.state.enabled = false;
      writeState(this.state);
      return;
    }
    this.chats = await groupmeChats(this.token).catch(() => []);
    if (this.client) await this.start();
    this.emit();
  }

  async pairChat(chatId: string) {
    const chat = this.chats.find((item) => item.id === chatId);
    if (!chat || !this.client) throw new Error(localized('Sign in to Matrix and GroupMe first.'));
    const existing = this.state.maps.find((map) => map.groupmeId === chat.id);
    if (existing) return existing.matrixRoomId;
    const created = await this.client.createRoom({
      name: chat.name,
      topic: topicFor(chat),
      preset: Preset.PrivateChat,
      visibility: Visibility.Private,
    });
    const map: BridgeMap = { groupmeId: chat.id, matrixRoomId: created.room_id };
    this.state.maps = [...this.state.maps, map];
    writeState(this.state);
    this.emit();
    return created.room_id;
  }

  mappedRoomId(groupmeId: string) {
    return this.state.maps.find((map) => map.groupmeId === groupmeId)?.matrixRoomId || null;
  }

  isBridgedRoom(roomId: string) {
    return this.state.maps.some((map) => map.matrixRoomId === roomId);
  }

  async handleOutgoingMatrixMessage(roomId: string, body: string, eventId?: string) {
    if (!this.token || !this.state.enabled) return false;
    const map = this.state.maps.find((item) => item.matrixRoomId === roomId);
    if (!map) return false;
    const chat = this.chats.find((item) => item.id === map.groupmeId);
    if (!chat) return false;
    const groupmeId = await groupmeSend(this.token, chat, body);
    map.lastGroupmeId = groupmeId;
    map.lastMatrixEventId = eventId;
    writeState(this.state);
    return true;
  }

  private _onMatrixTimeline = (event: MatrixEvent, room?: Room, toStartOfTimeline?: boolean) => {
    if (toStartOfTimeline || !room || !this.client) return;
    if (event.getSender() !== this.client.getUserId()) return;
    if (event.getType() !== EventType.RoomMessage) return;
    if (event.getContent()?.[PUPPET_EVENT]) return;
    const body = String(event.getContent()?.body || '').trim();
    if (!body) return;
    void this.handleOutgoingMatrixMessage(room.roomId, body, event.getId());
  };

  private async start() {
    if (!this.token || !this.client || this.polling) return;
    this.polling = true;
    await this.poll();
    this.timer = window.setInterval(() => void this.poll(), POLL_MS);
  }

  private stopPolling() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
    this.polling = false;
  }

  private async poll() {
    if (!this.token || !this.client) return;
    try {
      if (!this.chats.length) this.chats = await groupmeChats(this.token);
      for (const map of this.state.maps) {
        const chat = this.chats.find((item) => item.id === map.groupmeId);
        if (!chat) continue;
        const messages = await groupmeMessages(this.token, chat, map.lastGroupmeId);
        for (const message of messages) {
          if (message.id === map.lastGroupmeId) continue;
          if (this.state.userId && message.senderId === this.state.userId) {
            map.lastGroupmeId = message.id;
            continue;
          }
          await this.importToMatrix(map, message);
          map.lastGroupmeId = message.id;
        }
      }
      writeState(this.state);
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.emit();
  }

  private async importToMatrix(map: BridgeMap, message: GroupMeMessage) {
    if (!this.client) return;
    const body = `${message.senderName}: ${message.text}`;
    const result = await this.client.sendEvent(map.matrixRoomId, EventType.RoomMessage, {
      msgtype: MsgType.Text,
      body,
      [PUPPET_EVENT]: {
        id: message.id,
        senderId: message.senderId,
      },
    } as any);
    map.lastMatrixEventId = result.event_id;
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}

const groupMeBridge = new GroupMeBridge();
export default groupMeBridge;
