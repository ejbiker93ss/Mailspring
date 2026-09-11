const GROUPME_API = 'https://api.groupme.com/v3';
const GROUPME_V2 = 'https://v2.groupme.com';
const APP_ID = 'groupme-web';

export interface GroupMeUser {
  id: string;
  name: string;
}

export interface GroupMeMember {
  id: string;
  name: string;
}

export interface GroupMeMention {
  length: number;
  start: number;
  userId: string;
}

export interface GroupMeChat {
  conversationId: string;
  id: string;
  kind: 'group' | 'direct';
  lastMessage: string;
  lastMessageAt: number;
  lastMessageId: string | null;
  lastMessageSenderId: string | null;
  members: GroupMeMember[];
  name: string;
  unreadCount: number;
  unreadStateKnown?: boolean;
}

export interface GroupMeMessage {
  customEmoji?: GroupMeCustomEmoji[];
  baseReplyId: string | null;
  conversationId: string;
  createdAt: number;
  favoritedBy: string[];
  id: string;
  imageUrl: string | null;
  likedByMe: boolean;
  mentions: GroupMeMention[];
  reactions: GroupMeReaction[];
  replyToId: string | null;
  senderId: string;
  senderName: string;
  system: boolean;
  text: string;
}

export interface GroupMeCustomEmoji {
  start: number;
  length: number;
  packId: number;
  index: number;
}

export function mapGroupMeCustomEmoji(text: string, attachments: any[]): GroupMeCustomEmoji[] {
  const emoji: GroupMeCustomEmoji[] = [];
  for (const attachment of attachments) {
    if (
      attachment?.type !== 'emoji' ||
      typeof attachment.placeholder !== 'string' ||
      !attachment.placeholder ||
      !Array.isArray(attachment.charmap)
    )
      continue;
    let offset = 0;
    for (const pair of attachment.charmap) {
      const start = text.indexOf(attachment.placeholder, offset);
      if (start < 0) break;
      offset = start + attachment.placeholder.length;
      if (
        !Array.isArray(pair) ||
        !Number.isSafeInteger(pair[0]) ||
        pair[0] <= 0 ||
        !Number.isSafeInteger(pair[1]) ||
        pair[1] < 0
      )
        continue;
      emoji.push({ start, length: attachment.placeholder.length, packId: pair[0], index: pair[1] });
    }
  }
  return emoji.sort((a, b) => a.start - b.start);
}

export interface GroupMeReaction {
  count: number;
  emoji: string;
  likedByMe: boolean;
}

export const GROUPME_REACTION_EMOJIS = [
  '❤️',
  '👍',
  '🤣',
  '🎉',
  '🔥',
  '😮',
  '👀',
  '😭',
  '🥺',
  '🙏',
  '💀',
  '🫶',
  '🤬',
  '💅',
  '🫠',
] as const;

export interface GroupMeLoginResult {
  token: string;
  user: GroupMeUser;
}

export interface GroupMeMfaChallenge {
  code: string;
  hint?: string;
  methods: string[];
  smsSent?: boolean;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function previewText(message: Record<string, any> | null | undefined): string {
  if (!message) return '';
  const text = String(message.text || message.preview?.text || '').trim();
  if (text) return text;
  const attachments = message.attachments || message.preview?.attachments || [];
  if (attachments.some((item: any) => item?.type === 'image')) return 'Image';
  if (attachments.some((item: any) => item?.type === 'file')) return 'File';
  if (attachments.some((item: any) => item?.type === 'location')) return 'Location';
  return '';
}

function serverUnreadCount(
  unreadCount: unknown,
  lastMessageId?: unknown,
  lastReadMessageId?: unknown
): number {
  if (unreadCount !== null && unreadCount !== undefined) {
    const count = Number(unreadCount);
    return Number.isFinite(count) ? Math.max(0, count) : 0;
  }
  if (lastMessageId && lastReadMessageId) {
    return String(lastMessageId) === String(lastReadMessageId) ? 0 : 1;
  }
  return 0;
}

function imageFromAttachments(attachments: any[]): string | null {
  const image = (attachments || []).find((item) => item?.type === 'image' && item.url);
  return image ? String(image.url) : null;
}

function reactionEmoji(reaction: Record<string, any>): string {
  if (reaction.type === 'unicode' && typeof reaction.code === 'string') {
    return reaction.code;
  }
  return '❤️';
}

function mapReactions(raw: any, favoritedBy: string[], userId?: string | null): GroupMeReaction[] {
  const incoming = Array.isArray(raw) ? raw.map(asRecord) : [];
  if (incoming.length === 0) {
    return favoritedBy.length
      ? [
          {
            count: favoritedBy.length,
            emoji: '❤️',
            likedByMe: !!userId && favoritedBy.includes(String(userId)),
          },
        ]
      : [];
  }

  const grouped = new Map<string, { count: number; likedByMe: boolean }>();
  incoming.forEach((reaction, index) => {
    const emoji = reactionEmoji(reaction);
    const explicitIds = reaction.user_ids || reaction.userIds || reaction.favorited_by;
    let ids = Array.isArray(explicitIds) ? explicitIds.map(String) : [];
    if (ids.length === 0 && incoming.length === favoritedBy.length) ids = [favoritedBy[index]];
    if (ids.length === 0 && incoming.length === 1) ids = favoritedBy;
    const count = Number(reaction.count) || ids.length || 1;
    const current = grouped.get(emoji) || { count: 0, likedByMe: false };
    grouped.set(emoji, {
      count: current.count + count,
      likedByMe:
        current.likedByMe || (!!userId && ids.includes(String(userId))) || reaction.mine === true,
    });
  });
  return [...grouped].map(([emoji, value]) => ({ emoji, ...value }));
}

function mapMentions(attachments: any[]): GroupMeMention[] {
  const attachment = attachments.map(asRecord).find((item) => item.type === 'mentions');
  if (!attachment) return [];
  const userIds = Array.isArray(attachment.user_ids) ? attachment.user_ids.map(String) : [];
  const loci = Array.isArray(attachment.loci) ? attachment.loci : [];
  return userIds
    .map((userId: string, index: number) => {
      const locus = Array.isArray(loci[index]) ? loci[index] : [];
      return { userId, start: Number(locus[0]), length: Number(locus[1]) };
    })
    .filter(
      (mention: GroupMeMention) =>
        Number.isInteger(mention.start) &&
        mention.start >= 0 &&
        Number.isInteger(mention.length) &&
        mention.length > 0
    );
}

export function buildGroupMeMentions(text: string, members: GroupMeMember[]): GroupMeMention[] {
  const mentions: GroupMeMention[] = [];
  const occupied: Array<[number, number]> = [];
  const sortedMembers = [...members].sort((a, b) => b.name.length - a.name.length);

  sortedMembers.forEach((member) => {
    const needle = `@${member.name}`;
    if (needle.length <= 1) return;
    let start = 0;
    while (start < text.length) {
      const index = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase(), start);
      if (index < 0) break;
      const end = index + needle.length;
      const validBoundary = index === 0 || /\s/.test(text[index - 1]);
      const validEnd = end === text.length || /[\s.,!?;:()[\]{}]/.test(text[end]);
      const overlaps = occupied.some(([from, to]) => index < to && end > from);
      if (validBoundary && validEnd && !overlaps) {
        mentions.push({ userId: member.id, start: index, length: needle.length });
        occupied.push([index, end]);
      }
      start = end;
    }
  });

  return mentions.sort((a, b) => a.start - b.start);
}

export function mapGroupMeMessage(
  raw: any,
  conversationId: string,
  userId?: string | null
): GroupMeMessage | null {
  const message = asRecord(raw);
  const id = String(message.id || '');
  if (!id) return null;
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const text = String(message.text || '').trim();
  const imageUrl = imageFromAttachments(attachments);
  if (!text && !imageUrl && message.sender_type !== 'system') return null;
  const favoritedBy = Array.isArray(message.favorited_by)
    ? message.favorited_by.map((item: any) => String(item))
    : [];
  const reactions = mapReactions(message.reactions, favoritedBy, userId);
  const reply = attachments.map(asRecord).find((item) => item.type === 'reply');
  return {
    baseReplyId: reply ? String(reply.base_reply_id || reply.reply_id || '') || null : null,
    customEmoji: mapGroupMeCustomEmoji(text, attachments),
    conversationId: String(message.conversation_id || conversationId),
    createdAt: Number(message.created_at || 0) * 1000,
    favoritedBy,
    id,
    imageUrl,
    likedByMe: !!userId && favoritedBy.includes(String(userId)),
    mentions: mapMentions(attachments),
    reactions,
    replyToId: reply ? String(reply.reply_id || reply.base_reply_id || '') || null : null,
    senderId: String(message.sender_id || message.user_id || ''),
    senderName: String(message.name || 'GroupMe'),
    system: message.sender_type === 'system' || message.system === true,
    text: text || (imageUrl ? 'Image' : ''),
  };
}

export function mapGroupMeGroup(raw: any): GroupMeChat {
  const group = asRecord(raw);
  const preview = asRecord(group.messages?.preview);
  const members = Array.isArray(group.members)
    ? group.members.map((member: any) => ({
        id: String(member.user_id || member.id || ''),
        name: String(member.nickname || member.name || 'Member'),
      }))
    : [];
  return {
    conversationId: String(group.id),
    id: String(group.id),
    kind: 'group',
    lastMessage: previewText(preview),
    lastMessageAt: Number(group.messages?.last_message_created_at || group.updated_at || 0) * 1000,
    lastMessageId: group.messages?.last_message_id
      ? String(group.messages.last_message_id)
      : preview.id
        ? String(preview.id)
        : null,
    lastMessageSenderId: preview.sender_id ? String(preview.sender_id) : null,
    members: members.filter((member) => member.id),
    name: String(group.name || 'Group'),
    unreadCount: serverUnreadCount(
      group.unread_count ?? group.messages?.unread_count,
      group.messages?.last_message_id,
      group.last_read_message_id ?? group.messages?.last_read_message_id
    ),
  };
}

export function mapGroupMeDirect(raw: any, userId?: string | null): GroupMeChat {
  const chat = asRecord(raw);
  const other = asRecord(chat.other_user);
  const last = asRecord(chat.last_message);
  const otherId = String(other.id || last.recipient_id || '');
  const conversationId = String(
    last.conversation_id ||
      (userId && otherId ? [String(userId), otherId].sort().join('+') : otherId)
  );
  return {
    conversationId,
    id: otherId,
    kind: 'direct',
    lastMessage: previewText(last),
    lastMessageAt: Number(chat.updated_at || last.created_at || 0) * 1000,
    lastMessageId: last.id ? String(last.id) : null,
    lastMessageSenderId: last.sender_id ? String(last.sender_id) : null,
    members: otherId ? [{ id: otherId, name: String(other.name || 'Direct message') }] : [],
    name: String(other.name || 'Direct message'),
    unreadCount: serverUnreadCount(chat.unread_count, last.id, chat.last_read_message_id),
    unreadStateKnown: chat.unread_count != null || !!chat.last_read_message_id,
  };
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function groupmeFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(
    `${GROUPME_API}${path}${separator}token=${encodeURIComponent(token)}`,
    {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Access-Token': token,
        ...(init.headers || {}),
      },
    }
  );
  if (response.status === 304) return null as T;
  const json = await readJson(response);
  if (!response.ok) {
    throw new Error(json?.meta?.errors?.[0] || json?.message || 'GroupMe request failed.');
  }
  return (json.response ?? json) as T;
}

async function groupmeV2(
  path: string,
  init: RequestInit = {},
  token?: string
): Promise<{ json: any; status: number }> {
  const response = await fetch(`${GROUPME_V2}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { 'X-Access-Token': token } : {}),
      ...(init.headers || {}),
    },
  });
  return { json: await readJson(response), status: response.status };
}

export async function groupmeLogin(
  username: string,
  password: string,
  deviceId: string,
  verificationCode?: string
): Promise<GroupMeLoginResult | { mfa: GroupMeMfaChallenge }> {
  const body: Record<string, any> = {
    app_id: APP_ID,
    device_id: deviceId,
    grant_type: 'password',
    password,
    username,
  };
  if (verificationCode) body.verification = { code: verificationCode };
  const { json, status } = await groupmeV2('/access_tokens', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const payload = asRecord(json.response ?? json);
  if (status >= 400 || json?.meta?.errors?.length) {
    throw new Error(verificationError(json, 'GroupMe login failed.'));
  }
  if (status === 202 || payload.verification) {
    const verification = asRecord(payload.verification);
    if (typeof verification.code !== 'string' || !verification.code.trim()) {
      throw new Error('GroupMe did not return a valid verification ID. Please sign in again.');
    }
    return {
      mfa: {
        code: String(verification.code),
        hint: String(verification.methods?.sms || verification.methods?.email || ''),
        methods: Object.keys(asRecord(verification.methods)),
      },
    };
  }
  const token = String(payload.access_token || payload.token || '');
  if (!token) {
    throw new Error(json?.meta?.errors?.[0] || json?.error || 'GroupMe login failed.');
  }
  const user = asRecord(payload.user);
  return {
    token,
    user: {
      id: String(payload.user_id || user.id || ''),
      name: String(payload.user_name || user.name || username),
    },
  };
}

function verificationError(json: any, fallback: string) {
  return json?.meta?.errors?.[0] || json?.error || json?.message || fallback;
}

export async function groupmeInitiateSms(mfaId: string): Promise<string | null> {
  if (!mfaId || mfaId === 'undefined') throw new Error('Please sign in again to request a code.');
  const body = JSON.stringify({ verification: { method: 'sms' } });
  const response = await fetch(
    `${GROUPME_API}/verifications/${encodeURIComponent(mfaId)}/initiate`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body,
    }
  );
  const json = await readJson(response);
  if (!response.ok || json?.meta?.errors?.length || json?.error || json?.raw) {
    throw new Error(verificationError(json, 'Could not send a GroupMe verification text.'));
  }
  return json?.hint || json?.response?.hint || null;
}

export async function groupmeConfirmPin(mfaId: string, pin: string): Promise<void> {
  if (!mfaId || mfaId === 'undefined') throw new Error('Please sign in again to request a code.');
  if (!pin.trim()) throw new Error('Enter the code from GroupMe.');
  const body = JSON.stringify({ verification: { pin } });
  const response = await fetch(
    `${GROUPME_API}/verifications/${encodeURIComponent(mfaId)}/confirm`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body,
    }
  );
  const json = await readJson(response);
  if (response.ok && !json?.meta?.errors?.length && !json?.error && !json?.raw) return;
  if (json?.remaining_attempts != null) {
    throw new Error(`Incorrect PIN. ${json.remaining_attempts} attempts left.`);
  }
  throw new Error(verificationError(json, 'That GroupMe PIN was not accepted.'));
}

export async function groupmeMe(token: string): Promise<GroupMeUser> {
  const user = await groupmeFetch<any>(token, '/users/me');
  return { id: String(user.id), name: String(user.name || user.id) };
}

export async function groupmeChats(token: string, userId?: string | null): Promise<GroupMeChat[]> {
  const [groups, directs] = await Promise.all([
    groupmeFetch<any[]>(token, '/groups?per_page=100&omit=memberships'),
    groupmeFetch<any[]>(token, '/chats?per_page=100').catch(() => []),
  ]);
  const chats = [
    ...(groups || []).map(mapGroupMeGroup),
    ...(directs || []).map((chat) => mapGroupMeDirect(chat, userId)),
  ];
  return chats.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

export async function groupmeGroup(token: string, groupId: string): Promise<GroupMeChat> {
  return mapGroupMeGroup(await groupmeFetch<any>(token, `/groups/${encodeURIComponent(groupId)}`));
}

export async function groupmeMessages(
  token: string,
  chat: GroupMeChat,
  options: { sinceId?: string; beforeId?: string; userId?: string | null } = {}
): Promise<GroupMeMessage[]> {
  const query = new URLSearchParams({ limit: '100', acceptFiles: '1' });
  if (options.sinceId) query.set('since_id', options.sinceId);
  if (options.beforeId) query.set('before_id', options.beforeId);
  const path =
    chat.kind === 'direct'
      ? `/direct_messages?other_user_id=${encodeURIComponent(chat.id)}&${query.toString()}`
      : `/groups/${encodeURIComponent(chat.id)}/messages?${query.toString()}`;
  const response = await groupmeFetch<any>(token, path);
  if (!response) return [];
  const messages = response.messages || response.direct_messages || [];
  return messages
    .map((message: any) => mapGroupMeMessage(message, chat.conversationId, options.userId))
    .filter((message: GroupMeMessage | null): message is GroupMeMessage => !!message)
    .sort((a: GroupMeMessage, b: GroupMeMessage) => a.createdAt - b.createdAt);
}

export async function groupmeSend(
  token: string,
  chat: GroupMeChat,
  text: string,
  options: {
    baseReplyId?: string | null;
    mentions?: GroupMeMention[];
    replyToId?: string | null;
  } = {}
): Promise<string> {
  const sourceGuid = `summermail-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const attachments: any[] = [];
  if (options.replyToId) {
    attachments.push({
      type: 'reply',
      reply_id: options.replyToId,
      base_reply_id: options.baseReplyId || options.replyToId,
    });
  }
  if (options.mentions?.length) {
    attachments.push({
      type: 'mentions',
      user_ids: options.mentions.map((mention) => mention.userId),
      loci: options.mentions.map((mention) => [mention.start, mention.length]),
    });
  }
  if (chat.kind === 'direct') {
    const response = await groupmeFetch<any>(token, '/direct_messages', {
      method: 'POST',
      body: JSON.stringify({
        direct_message: {
          source_guid: sourceGuid,
          recipient_id: chat.id,
          text,
          attachments,
        },
      }),
    });
    return String(response.direct_message?.id || sourceGuid);
  }
  const response = await groupmeFetch<any>(
    token,
    `/groups/${encodeURIComponent(chat.id)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        message: {
          source_guid: sourceGuid,
          text,
          attachments,
        },
      }),
    }
  );
  return String(response.message?.id || sourceGuid);
}

export async function groupmeMarkRead(
  token: string,
  chat: GroupMeChat,
  messageId: string
): Promise<void> {
  if (chat.kind !== 'direct' || !messageId) return;
  const { json, status } = await groupmeV2(
    '/read_receipts',
    {
      method: 'POST',
      body: JSON.stringify({
        read_receipt: {
          chat_id: chat.conversationId,
          message_id: messageId,
        },
      }),
    },
    token
  );
  if (status >= 400 || json?.meta?.errors?.length || json?.error) {
    throw new Error(verificationError(json, 'Could not sync the GroupMe read status.'));
  }
}

export function groupmeUnreadAfterReceipt(
  chat: GroupMeChat,
  receiptId: string | null | undefined,
  userId?: string | null,
  observedUnread = 0
): number {
  if (!chat.lastMessageId || (userId && chat.lastMessageSenderId === userId)) return 0;
  const count = chat.unreadStateKnown
    ? chat.unreadCount
    : Math.max(chat.unreadCount, observedUnread);
  // Legacy receipts can be years behind the official client's read state.
  // They can acknowledge unread messages, but cannot establish unread state.
  if (!receiptId) return count;
  if (receiptId === chat.lastMessageId) return 0;
  // GroupMe IDs exceed JavaScript's safe integer range. Compare decimal strings.
  if (/^\d+$/.test(receiptId) && /^\d+$/.test(chat.lastMessageId)) {
    const read = receiptId.replace(/^0+/, '') || '0';
    const last = chat.lastMessageId.replace(/^0+/, '') || '0';
    const newer = last.length > read.length || (last.length === read.length && last > read);
    return newer ? count : 0;
  }
  return count;
}

export async function groupmeDirectReadMessageId(
  token: string,
  otherUserId: string
): Promise<string | null> {
  const { json, status } = await groupmeV2(
    `/read_receipts?other_user_id=${encodeURIComponent(otherUserId)}`,
    { method: 'GET' },
    token
  );
  if (status >= 400 || json?.meta?.errors?.length || json?.error) {
    throw new Error(verificationError(json, 'Could not load the GroupMe read status.'));
  }
  const receipt = asRecord(json?.response?.read_receipt);
  return receipt.message_id || receipt.id ? String(receipt.message_id || receipt.id) : null;
}

export async function groupmeSetReaction(
  token: string,
  conversationId: string,
  messageId: string,
  emoji: string | null
): Promise<void> {
  if (emoji && !GROUPME_REACTION_EMOJIS.includes(emoji as any)) {
    throw new Error('GroupMe does not support that reaction.');
  }
  const action = emoji ? 'like' : 'unlike';
  await groupmeFetch(
    token,
    `/messages/${encodeURIComponent(conversationId)}/${encodeURIComponent(messageId)}/${action}`,
    {
      method: 'POST',
      body: emoji ? JSON.stringify({ like_icon: { type: 'unicode', code: emoji } }) : '{}',
    }
  );
}

export async function groupmeLogout(token: string): Promise<void> {
  try {
    await groupmeV2('/access_tokens/current/destroy', { method: 'POST' }, token);
  } catch {
    // Local sign-out still proceeds if GroupMe rejects the unofficial revoke call.
  }
}
