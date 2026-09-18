import {
  Actions,
  KeyManager,
  NativeNotifications,
  WorkspaceStore,
  localized,
} from 'summermail-exports';
import SummerMailStore from 'summermail-store';
import {
  GroupMeChat,
  GroupMeMember,
  GroupMeMessage,
  GroupMeMfaChallenge,
  GroupMeUser,
  buildGroupMeMentions,
  groupmeChats,
  groupmeConfirmPin,
  groupmeDirectReadMessageId,
  groupmeGroup,
  groupmeInitiateSms,
  groupmeLogin,
  groupmeLogout,
  groupmeMarkRead,
  groupmeMe,
  groupmeMessages,
  groupmeSend,
  groupmeSetReaction,
  groupmeUnreadAfterReceipt,
} from './groupme-client';

const TOKEN_KEY = 'groupme-access-token';
const ENABLED_KEY = 'groupme-chat.enabled';
const DEVICE_KEY = 'groupme-chat.device-id';
const HIDDEN_CHATS_KEY = 'groupme-chat.hidden-chats';
const ROOMS_COLLAPSED_KEY = 'groupme-chat.rooms-collapsed';
const PEOPLE_COLLAPSED_KEY = 'groupme-chat.people-collapsed';
const UNREAD_STATE_KEY = 'groupme-chat.unread-state';
const LEGACY_STATE_KEY = 'matrix-chat.groupme';
const LIST_POLL_MS = 8000;
const MESSAGE_POLL_MS = 3000;
const MAX_UNREAD_COUNT = 9999;

export type GroupMeConnectionState = 'idle' | 'connecting' | 'ready' | 'error';

function deviceId() {
  const existing = AppEnv.config.get(DEVICE_KEY);
  if (typeof existing === 'string' && existing.length >= 8) return existing;
  const created = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  AppEnv.config.set(DEVICE_KEY, created);
  return created;
}

function hiddenChatIds(): string[] {
  const stored = AppEnv.config.get(HIDDEN_CHATS_KEY);
  return Array.isArray(stored) ? stored.filter((value) => typeof value === 'string') : [];
}

function chatKey(chat: GroupMeChat) {
  return `${chat.kind}:${chat.id}`;
}

type SavedUnreadState = {
  lastMessageId: string | null;
  unreadCount: number;
};

function savedUnreadStates(): Map<string, SavedUnreadState> {
  const stored = AppEnv.config.get(UNREAD_STATE_KEY);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return new Map();
  return new Map(
    Object.entries(stored as Record<string, unknown>).flatMap(([key, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const entry = value as Record<string, unknown>;
      const unreadCount = Number(entry.unreadCount);
      return [
        [
          key,
          {
            lastMessageId: typeof entry.lastMessageId === 'string' ? entry.lastMessageId : null,
            unreadCount: Number.isFinite(unreadCount) ? Math.max(0, unreadCount) : 0,
          },
        ] as [string, SavedUnreadState],
      ];
    })
  );
}

function initials(name: string) {
  const value = name.replace(/^[#@]/, '').trim();
  if (!value) return '?';
  const Segmenter = (Intl as any).Segmenter;
  const split = (part: string) =>
    Segmenter
      ? [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(part)].map(
          (entry: any) => entry.segment
        )
      : Array.from(part);
  const parts = value.split(/\s+/).filter(Boolean);
  const first = split(parts[0])[0] || '?';
  if (!/[\p{L}\p{N}]/u.test(first)) return first;
  const second = parts[1] ? split(parts[1])[0] || '' : '';
  return `${first}${second}`.toLocaleUpperCase();
}

export class GroupMeChatStoreClass extends SummerMailStore {
  private _chats: GroupMeChat[] = [];
  private _conversationStates = new Map<
    string,
    { draft: string; reply: GroupMeMessage | null; sending: boolean; timeline: GroupMeMessage[] }
  >();
  private _visibleChatIds: string[] = [];
  private conversationState(id = this._selectedChatId) {
    const key = id || '';
    if (!this._conversationStates.has(key))
      this._conversationStates.set(key, { draft: '', reply: null, sending: false, timeline: [] });
    return this._conversationStates.get(key)!;
  }
  private get _composerDraft() {
    return this.conversationState().draft;
  }
  private set _composerDraft(value: string) {
    this.conversationState().draft = value;
  }
  private get _replyingTo() {
    return this.conversationState().reply;
  }
  private set _replyingTo(value: GroupMeMessage | null) {
    this.conversationState().reply = value;
  }
  private get _sending() {
    return this.conversationState().sending;
  }
  private set _sending(value: boolean) {
    this.conversationState().sending = value;
  }
  private get _timeline() {
    return this.conversationState().timeline;
  }
  private set _timeline(value: GroupMeMessage[]) {
    this.conversationState().timeline = value;
  }
  private _connectionState: GroupMeConnectionState = 'idle';
  private _error: string | null = null;
  private _hiddenChatIds = new Set(hiddenChatIds());
  private _listTimer: number | null = null;
  private _members: GroupMeMember[] = [];
  private _messageTimer: number | null = null;
  private _mfa: GroupMeMfaChallenge | null = null;
  private _pendingPassword = '';
  private _pendingUsername = '';
  private _readReceipts = new Map<string, string | null>();
  private _restoring = false;
  private _searchQuery = '';
  private _selectedChatId: string | null = null;
  private _token: string | null = null;
  private _unreadStates = savedUnreadStates();
  private _user: GroupMeUser | null = null;

  constructor() {
    super();
    void this.restore();
  }

  chats() {
    return this._chats;
  }

  hiddenChats() {
    return this._chats.filter((chat) => this._hiddenChatIds.has(chatKey(chat)));
  }

  isChatHidden(chatId: string) {
    return this._hiddenChatIds.has(chatId);
  }

  composerDraft(id = this._selectedChatId) {
    return this.conversationState(id).draft;
  }

  connectionState() {
    return this._connectionState;
  }

  error() {
    return this._error;
  }

  isLoggedIn() {
    return !!this._token && !!this._user;
  }

  members(id = this._selectedChatId) {
    return id === this._selectedChatId ? this._members : this.selectedChat(id)?.members || [];
  }

  roomsCollapsed() {
    return AppEnv.config.get(ROOMS_COLLAPSED_KEY) === true;
  }

  peopleCollapsed() {
    return AppEnv.config.get(PEOPLE_COLLAPSED_KEY) === true;
  }

  mfa() {
    return this._mfa;
  }

  restoring() {
    return this._restoring;
  }

  replyingTo(id = this._selectedChatId) {
    return this.conversationState(id).reply;
  }

  searchQuery() {
    return this._searchQuery;
  }

  selectedChat(id = this._selectedChatId) {
    return this._chats.find((chat) => chatKey(chat) === id) || null;
  }

  selectedChatId() {
    return this._selectedChatId;
  }

  sending(id = this._selectedChatId) {
    return this.conversationState(id).sending;
  }

  timeline(id = this._selectedChatId) {
    return this.conversationState(id).timeline;
  }

  setVisibleChats(ids: string[]) {
    this._visibleChatIds = ids;
    for (const id of ids) void this._loadSelected(false, id);
  }

  unreadCount() {
    const total = this._chats.reduce(
      (sum, chat) =>
        sum + (chat.unreadCount > 0 && !this._hiddenChatIds.has(chatKey(chat)) ? 1 : 0),
      0
    );
    return Math.min(total, MAX_UNREAD_COUNT);
  }

  userName() {
    return this._user?.name || null;
  }

  userId() {
    return this._user?.id || null;
  }

  setComposerDraft(value: string, id = this._selectedChatId) {
    if (this.conversationState(id).draft === value) return;
    this.conversationState(id).draft = value;
    this.trigger(this);
  }

  setReplyingTo(message: GroupMeMessage | null, id = this._selectedChatId) {
    if (this.conversationState(id).reply?.id === message?.id) return;
    this.conversationState(id).reply = message;
    this.trigger(this);
  }

  setSearchQuery(value: string) {
    if (this._searchQuery === value) return;
    this._searchQuery = value;
    this.trigger(this);
  }

  toggleRoomsCollapsed() {
    AppEnv.config.set(ROOMS_COLLAPSED_KEY, !this.roomsCollapsed());
    this.trigger(this);
  }

  togglePeopleCollapsed() {
    AppEnv.config.set(PEOPLE_COLLAPSED_KEY, !this.peopleCollapsed());
    this.trigger(this);
  }

  hideChat(chatId: string) {
    if (this._hiddenChatIds.has(chatId)) return;
    this._hiddenChatIds.add(chatId);
    AppEnv.config.set(HIDDEN_CHATS_KEY, [...this._hiddenChatIds]);
    if (this._selectedChatId === chatId) {
      this._selectedChatId = null;
      this._timeline = [];
      this._members = [];
    }
    this.trigger(this);
  }

  showChat(chatId: string) {
    if (!this._hiddenChatIds.delete(chatId)) return;
    AppEnv.config.set(HIDDEN_CHATS_KEY, [...this._hiddenChatIds]);
    this.trigger(this);
  }

  showAllChats() {
    if (this._hiddenChatIds.size === 0) return;
    this._hiddenChatIds.clear();
    AppEnv.config.set(HIDDEN_CHATS_KEY, []);
    this.trigger(this);
  }

  openFromChatArea() {
    AppEnv.config.set(ENABLED_KEY, true);
    this.trigger(this);
    window.setTimeout(() => {
      if (WorkspaceStore.Sheet.GroupMe) {
        Actions.selectRootSheet(WorkspaceStore.Sheet.GroupMe);
      }
    }, 0);
  }

  async restore() {
    const legacy = AppEnv.config.get(LEGACY_STATE_KEY) as { enabled?: boolean } | null;
    if (legacy?.enabled && AppEnv.config.get(ENABLED_KEY) !== true) {
      AppEnv.config.set(ENABLED_KEY, true);
    }
    const token = (await KeyManager.getPassword(TOKEN_KEY)) || null;
    if (!token) return;
    this._restoring = true;
    this._connectionState = 'connecting';
    this.trigger(this);
    try {
      await this._startWithToken(token);
    } catch (error) {
      this._connectionState = 'error';
      this._error = error instanceof Error ? error.message : String(error);
      this._restoring = false;
      this.trigger(this);
    }
  }

  async connectWithToken(token: string) {
    const trimmed = token.trim();
    if (!trimmed) throw new Error(localized('Paste a GroupMe access token.'));
    this._connectionState = 'connecting';
    this._error = null;
    this._mfa = null;
    this.trigger(this);
    await this._startWithToken(trimmed);
  }

  async login(username: string, password: string) {
    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      throw new Error(localized('Enter your GroupMe email and password.'));
    }
    this._connectionState = 'connecting';
    this._error = null;
    this._pendingUsername = trimmedUser;
    this._pendingPassword = password;
    this.trigger(this);
    try {
      const result = await groupmeLogin(trimmedUser, password, deviceId());
      if ('mfa' in result) {
        this._mfa = result.mfa;
        this._connectionState = 'idle';
        const hint = await groupmeInitiateSms(result.mfa.code);
        this._mfa = { ...result.mfa, hint: hint || result.mfa.hint, smsSent: true };
        this.trigger(this);
        return;
      }
      await this._startWithToken(result.token, result.user);
    } catch (error) {
      this._connectionState = 'error';
      this._error = error instanceof Error ? error.message : String(error);
      this.trigger(this);
      throw error;
    }
  }

  async confirmMfa(pin: string) {
    if (!this._mfa) throw new Error(localized('No GroupMe verification is waiting.'));
    this._connectionState = 'connecting';
    this._error = null;
    this.trigger(this);
    try {
      await groupmeConfirmPin(this._mfa.code, pin.trim());
      const result = await groupmeLogin(
        this._pendingUsername,
        this._pendingPassword,
        deviceId(),
        this._mfa.code
      );
      if ('mfa' in result) {
        throw new Error(localized('GroupMe still needs verification. Try the PIN again.'));
      }
      this._mfa = null;
      this._pendingPassword = '';
      await this._startWithToken(result.token, result.user);
    } catch (error) {
      this._connectionState = 'error';
      this._error = error instanceof Error ? error.message : String(error);
      this.trigger(this);
      throw error;
    }
  }

  async resendMfaSms() {
    if (!this._mfa) throw new Error(localized('No GroupMe verification is waiting.'));
    this._connectionState = 'connecting';
    this._error = null;
    this._mfa = { ...this._mfa, smsSent: false };
    this.trigger(this);
    try {
      const hint = await groupmeInitiateSms(this._mfa.code);
      this._mfa = { ...this._mfa, hint: hint || this._mfa.hint, smsSent: true };
      this._connectionState = 'idle';
      this.trigger(this);
    } catch (error) {
      this._connectionState = 'idle';
      this._error = error instanceof Error ? error.message : String(error);
      this.trigger(this);
      throw error;
    }
  }

  cancelMfa() {
    this._mfa = null;
    this._pendingPassword = '';
    this._pendingUsername = '';
    this._error = null;
    this._connectionState = 'idle';
    this.trigger(this);
  }

  async logout() {
    const token = this._token;
    this._stopPolling();
    this._chats = [];
    this._composerDraft = '';
    this._connectionState = 'idle';
    this._error = null;
    this._members = [];
    this._mfa = null;
    this._pendingPassword = '';
    this._pendingUsername = '';
    this._readReceipts.clear();
    this._replyingTo = null;
    this._selectedChatId = null;
    this._timeline = [];
    this._token = null;
    this._user = null;
    this._conversationStates.clear();
    this._visibleChatIds = [];
    this.trigger(this);
    await KeyManager.deletePassword(TOKEN_KEY);
    if (token) await groupmeLogout(token);
  }

  selectChat(chatId: string) {
    if (this._selectedChatId === chatId) return;
    this._selectedChatId = chatId;
    const chat = this.selectedChat();
    this._members = chat?.members || [];
    this.trigger(this);
    void this._loadSelected(true);
  }

  startDirectMessage(member: GroupMeMember) {
    if (!member.id || member.id === this._user?.id) return;
    const id = `direct:${member.id}`;
    const existing = this._chats.find((chat) => chatKey(chat) === id);
    if (!existing) {
      const conversationId = [this._user?.id || '', member.id].filter(Boolean).sort().join('+');
      this._chats = [
        {
          avatarUrl: null,
          conversationId,
          id: member.id,
          kind: 'direct',
          lastMessage: '',
          lastMessageAt: Date.now(),
          lastMessageId: null,
          lastMessageSenderId: null,
          members: [member],
          name: member.name,
          unreadCount: 0,
        },
        ...this._chats,
      ];
    }
    this.selectChat(id);
  }

  async sendMessage(id = this._selectedChatId) {
    const chat = this.selectedChat(id);
    const state = this.conversationState(id);
    const body = state.draft.trim();
    if (!this._token || !chat || !body || state.sending) return;
    const replyingTo = state.reply;
    const mentions = buildGroupMeMentions(body, this.members(id));
    state.sending = true;
    state.draft = '';
    this.trigger(this);
    try {
      await groupmeSend(this._token, chat, body, {
        baseReplyId: replyingTo?.baseReplyId,
        mentions,
        replyToId: replyingTo?.id,
      });
      state.reply = null;
      await this._loadSelected(false, id);
      await this.refreshChats();
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
      state.draft = state.draft ? `${body}\n${state.draft}` : body;
    } finally {
      state.sending = false;
      this.trigger(this);
    }
  }

  async setReaction(message: GroupMeMessage, emoji: string, id = this._selectedChatId) {
    if (!this._token) return;
    try {
      const current = message.reactions.find((reaction) => reaction.likedByMe)?.emoji;
      await groupmeSetReaction(
        this._token,
        message.conversationId,
        message.id,
        current === emoji ? null : emoji
      );
      await this._loadSelected(true, id);
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
      this.trigger(this);
    }
  }

  async sendMessageToChat(chatId: string, body: string) {
    const chat = this._chats.find((item) => chatKey(item) === chatId);
    const text = body.trim();
    if (!this._token || !chat || !text) return;
    try {
      await groupmeSend(this._token, chat, text, {
        mentions: buildGroupMeMentions(text, chat.members),
      });
      if (this._selectedChatId === chatId) await this._loadSelected(false);
      await this.refreshChats();
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
      this.trigger(this);
    }
  }

  async refreshChats() {
    const token = this._token;
    if (!token) return;
    const previous = new Map(this._chats.map((chat) => [chatKey(chat), chat]));
    const refreshed = await groupmeChats(token, this._user?.id);
    const pendingDirects = this._chats.filter(
      (chat) =>
        chat.kind === 'direct' &&
        !chat.lastMessageId &&
        !refreshed.some((candidate) => chatKey(candidate) === chatKey(chat))
    );
    this._chats = [...refreshed, ...pendingDirects].sort(
      (a, b) => b.lastMessageAt - a.lastMessageAt
    );
    const receiptChecks = this._chats.filter((chat) => {
      if (chat.kind !== 'direct') return false;
      const key = chatKey(chat);
      return (
        !this._readReceipts.has(key) ||
        previous.get(key)?.lastMessageId !== chat.lastMessageId ||
        previous.get(key)?.unreadCount > 0
      );
    });
    for (let index = 0; index < receiptChecks.length; index += 8) {
      const batch = receiptChecks.slice(index, index + 8);
      await Promise.all(
        batch.map(async (chat) => {
          try {
            this._readReceipts.set(chatKey(chat), await groupmeDirectReadMessageId(token, chat.id));
          } catch {
            // Keep the prior receipt when GroupMe temporarily rejects a read-state request.
          }
        })
      );
    }
    this._chats = this._chats.map((chat) => {
      const key = chatKey(chat);
      if (
        this._selectedChatId === key &&
        WorkspaceStore.rootSheet()?.id === 'GroupMe' &&
        AppEnv.getCurrentWindow().isFocused()
      )
        return { ...chat, unreadCount: 0 };
      const before = previous.get(key);
      const saved = this._unreadStates.get(key);
      const incoming =
        !!(before || saved) &&
        !!chat.lastMessageId &&
        chat.lastMessageId !== (before?.lastMessageId || saved?.lastMessageId) &&
        !!chat.lastMessageSenderId &&
        chat.lastMessageSenderId !== this._user?.id;
      let unreadCount = Math.max(
        chat.unreadCount,
        before?.unreadCount || 0,
        saved?.unreadCount || 0
      );
      if (incoming) unreadCount = Math.max(1, unreadCount);
      if (chat.kind === 'direct') {
        unreadCount = groupmeUnreadAfterReceipt(
          { ...chat, unreadCount, unreadStateKnown: false },
          this._readReceipts.get(key),
          this._user?.id,
          unreadCount
        );
      }
      return { ...chat, unreadCount };
    });
    this._saveUnreadStates();
    for (const chat of this._chats) {
      const before = previous.get(chatKey(chat));
      if (
        before &&
        chat.lastMessage &&
        (chat.lastMessageAt !== before.lastMessageAt || chat.lastMessage !== before.lastMessage) &&
        !(
          chatKey(chat) === this._selectedChatId &&
          WorkspaceStore.rootSheet()?.id === 'GroupMe' &&
          AppEnv.getCurrentWindow().isFocused()
        )
      ) {
        this._notify(chat);
      }
    }
    const selected = this.selectedChat();
    if (selected?.kind === 'group' && selected.members.length === 0) {
      const detailed = await groupmeGroup(this._token, selected.id).catch(() => null);
      if (detailed) {
        this._members = detailed.members;
        this._chats = this._chats.map((chat) =>
          chatKey(chat) === chatKey(detailed)
            ? {
                ...detailed,
                unreadCount:
                  this._chats.find((item) => chatKey(item) === chatKey(detailed))?.unreadCount || 0,
              }
            : chat
        );
      }
    } else {
      this._members = selected?.members || [];
    }
    this.trigger(this);
  }

  private async _startWithToken(token: string, user?: GroupMeUser) {
    const resolved = user || (await groupmeMe(token));
    await KeyManager.replacePassword(TOKEN_KEY, token);
    AppEnv.config.set(ENABLED_KEY, true);
    this._token = token;
    this._user = resolved;
    this._mfa = null;
    this._pendingPassword = '';
    this._restoring = false;
    this._error = null;
    this._connectionState = 'ready';
    await this.refreshChats();
    this._startPolling();
    this.trigger(this);
  }

  private async _loadSelected(replace: boolean, id = this._selectedChatId) {
    const chat = this.selectedChat(id);
    if (!this._token || !chat) return;
    const token = this._token;
    const state = this.conversationState(id);
    try {
      const latest = state.timeline[state.timeline.length - 1];
      const messages = await groupmeMessages(this._token, chat, {
        sinceId: replace ? undefined : latest?.id,
        userId: this._user?.id,
      });
      if (token !== this._token) return;
      if (replace) {
        state.timeline = messages;
      } else if (messages.length) {
        const seen = new Set(state.timeline.map((item) => item.id));
        state.timeline = [...state.timeline, ...messages.filter((item) => !seen.has(item.id))];
      }
      const last = state.timeline[state.timeline.length - 1];
      const key = chatKey(chat);
      const visible =
        (this._selectedChatId === key || this._visibleChatIds.includes(key)) &&
        WorkspaceStore.rootSheet()?.id === 'GroupMe' &&
        AppEnv.getCurrentWindow().isFocused();
      if (last && visible && this._readReceipts.get(key) !== last.id) {
        await groupmeMarkRead(this._token, chat, last.id);
        this._readReceipts.set(key, last.id);
      }
      this._chats = this._chats.map((item) =>
        visible && chatKey(item) === chatKey(chat) ? { ...item, unreadCount: 0 } : item
      );
      this._saveUnreadStates();
      this._error = null;
      this.trigger(this);
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
      this.trigger(this);
    }
  }

  private _saveUnreadStates() {
    const states: Record<string, SavedUnreadState> = {};
    for (const chat of this._chats) {
      const key = chatKey(chat);
      const state = {
        lastMessageId: chat.lastMessageId,
        unreadCount: Math.max(0, chat.unreadCount),
      };
      this._unreadStates.set(key, state);
      states[key] = state;
    }
    AppEnv.config.set(UNREAD_STATE_KEY, states);
  }

  private _startPolling() {
    this._stopPolling();
    this._listTimer = window.setInterval(() => void this.refreshChats(), LIST_POLL_MS);
    this._messageTimer = window.setInterval(() => {
      const ids = this._visibleChatIds.length ? this._visibleChatIds : [this._selectedChatId];
      for (const id of ids) if (id) void this._loadSelected(false, id);
    }, MESSAGE_POLL_MS);
  }

  private _stopPolling() {
    if (this._listTimer) window.clearInterval(this._listTimer);
    if (this._messageTimer) window.clearInterval(this._messageTimer);
    this._listTimer = null;
    this._messageTimer = null;
  }

  private _notify(chat: GroupMeChat) {
    const id = chatKey(chat);
    void NativeNotifications.displayNotification({
      title: chat.name,
      subtitle: localized('GroupMe'),
      body: chat.lastMessage,
      tag: id,
      threadId: id,
      messageId: chat.lastMessageId || undefined,
      canReply: true,
      replyPlaceholder: localized('Reply to %@', chat.name),
      onActivate: ({ response, activationType }) => {
        if (activationType === 'replied' && response?.trim()) {
          void this.sendMessageToChat(id, response);
          return;
        }
        AppEnv.config.set(ENABLED_KEY, true);
        this.selectChat(id);
        if (WorkspaceStore.Sheet.GroupMe) {
          Actions.selectRootSheet(WorkspaceStore.Sheet.GroupMe);
        }
      },
    });
  }
}

export { initials };
const GroupMeChatStore = new GroupMeChatStoreClass();
export default GroupMeChatStore;
