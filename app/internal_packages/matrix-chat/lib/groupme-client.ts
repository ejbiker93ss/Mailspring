const GROUPME_API = 'https://api.groupme.com/v3';

export interface GroupMeUser {
  id: string;
  name: string;
}

export interface GroupMeChat {
  id: string;
  kind: 'group' | 'direct';
  name: string;
}

export interface GroupMeMessage {
  createdAt: number;
  id: string;
  senderId: string;
  senderName: string;
  text: string;
}

async function groupmeFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(
    `${GROUPME_API}${path}${separator}token=${encodeURIComponent(token)}`,
    {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Token': token,
        ...(init.headers || {}),
      },
    }
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.meta?.errors?.[0] || 'GroupMe request failed.');
  }
  return json.response as T;
}

export async function groupmeMe(token: string): Promise<GroupMeUser> {
  const user = await groupmeFetch<any>(token, '/users/me');
  return { id: String(user.id), name: String(user.name || user.id) };
}

export async function groupmeChats(token: string): Promise<GroupMeChat[]> {
  const [groups, directs] = await Promise.all([
    groupmeFetch<any[]>(token, '/groups?per_page=100'),
    groupmeFetch<any[]>(token, '/chats?per_page=100').catch(() => []),
  ]);
  return [
    ...(groups || []).map((group) => ({
      id: String(group.id),
      kind: 'group' as const,
      name: String(group.name || 'Group'),
    })),
    ...(directs || []).map((chat) => ({
      id: String(chat.other_user?.id || chat.id),
      kind: 'direct' as const,
      name: String(chat.other_user?.name || 'Direct message'),
    })),
  ];
}

export async function groupmeMessages(
  token: string,
  chat: GroupMeChat,
  sinceId?: string
): Promise<GroupMeMessage[]> {
  const path =
    chat.kind === 'direct'
      ? `/direct_messages?other_user_id=${encodeURIComponent(chat.id)}${sinceId ? `&since_id=${sinceId}` : ''}`
      : `/groups/${encodeURIComponent(chat.id)}/messages?limit=20${sinceId ? `&since_id=${sinceId}` : ''}`;
  const response = await groupmeFetch<any>(token, path);
  const messages = response.messages || response.direct_messages || [];
  return messages
    .map((message: any) => ({
      createdAt: Number(message.created_at || 0) * 1000,
      id: String(message.id),
      senderId: String(message.sender_id || message.user_id || ''),
      senderName: String(message.name || 'GroupMe'),
      text: String(message.text || '').trim(),
    }))
    .filter((message: GroupMeMessage) => message.id && message.text)
    .sort((a: GroupMeMessage, b: GroupMeMessage) => a.createdAt - b.createdAt);
}

export async function groupmeSend(token: string, chat: GroupMeChat, text: string): Promise<string> {
  const sourceGuid = `summermail-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (chat.kind === 'direct') {
    const response = await groupmeFetch<any>(token, '/direct_messages', {
      method: 'POST',
      body: JSON.stringify({
        direct_message: {
          source_guid: sourceGuid,
          recipient_id: chat.id,
          text,
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
        },
      }),
    }
  );
  return String(response.message?.id || sourceGuid);
}
