import { AccountStore } from 'mailspring-exports';
import type { AssistantChatMessage } from './openai-mail-assistant-client';

export interface StoredAssistantMessage extends AssistantChatMessage {
  id: string;
  error?: boolean;
  attachments?: Array<{ name: string; mimeType: string; sizeBytes: number }>;
}

export interface StoredAssistantAction {
  id: string;
  name: 'create_email_draft' | 'create_calendar_event' | 'move_threads' | 'mark_threads_read';
  arguments: Record<string, any>;
  status?: 'running' | 'done' | 'cancelled' | 'error';
  error?: string;
  afterMessageId?: string;
}

export interface MailAssistantConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredAssistantMessage[];
  actions: StoredAssistantAction[];
  aliases?: Record<string, string>;
  redactPersonalInfo?: boolean;
}

const MAX_CONVERSATIONS = 10;
const MAX_MESSAGES = 200;

function ownerKey() {
  const account = AccountStore.accounts()[0];
  return String((account && account.emailAddress) || 'local').toLowerCase();
}

function storageKey(kind: 'conversations' | 'draft') {
  return `mailspring.mailAssistant.${kind}.${ownerKey()}`;
}

export function loadMailAssistantConversations(): MailAssistantConversation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey('conversations')) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === 'string' && Array.isArray(item.messages))
      .map(anchorLegacyActions)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONVERSATIONS);
  } catch {
    return [];
  }
}

export function anchorLegacyActions(
  conversation: MailAssistantConversation
): MailAssistantConversation {
  const actions = Array.isArray(conversation.actions) ? conversation.actions : [];
  if (!actions.some((action) => !action.afterMessageId)) return conversation;
  const assistantTurns = conversation.messages.filter((message) => message.role === 'assistant');
  const proposalTurns = assistantTurns.filter((message) =>
    /prepared|action|review|move messages|draft email|calendar event/i.test(message.content)
  );
  const anchors = proposalTurns.length ? proposalTurns : assistantTurns;
  return {
    ...conversation,
    actions: actions.map((action, index) => ({
      ...action,
      afterMessageId:
        action.afterMessageId || anchors[Math.min(index, Math.max(anchors.length - 1, 0))]?.id,
    })),
  };
}

export function saveMailAssistantConversation(conversation: MailAssistantConversation) {
  const conversations = loadMailAssistantConversations().filter(
    (item) => item.id !== conversation.id
  );
  const bounded = {
    ...conversation,
    title: (conversation.title || 'New chat').replace(/\s+/g, ' ').trim().slice(0, 60),
    messages: conversation.messages.slice(-MAX_MESSAGES),
    actions: conversation.actions.filter((action) => action.status !== 'running').slice(-100),
    aliases: conversation.aliases || {},
    redactPersonalInfo: conversation.redactPersonalInfo !== false,
    updatedAt: Date.now(),
  };
  localStorage.setItem(
    storageKey('conversations'),
    JSON.stringify([bounded, ...conversations].slice(0, MAX_CONVERSATIONS))
  );
  return bounded;
}

export function deleteMailAssistantConversation(id: string) {
  localStorage.setItem(
    storageKey('conversations'),
    JSON.stringify(loadMailAssistantConversations().filter((item) => item.id !== id))
  );
}

export function loadMailAssistantDraft() {
  return localStorage.getItem(storageKey('draft')) || '';
}

export function saveMailAssistantDraft(value: string) {
  if (value) localStorage.setItem(storageKey('draft'), value.slice(0, 8000));
  else localStorage.removeItem(storageKey('draft'));
}
