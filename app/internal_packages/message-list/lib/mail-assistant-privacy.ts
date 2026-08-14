import { Message, Thread } from 'mailspring-exports';

export interface MailAssistantAliasMap {
  aliasesByEmail: Map<string, string>;
  emailsByAlias: Map<string, string>;
  names: string[];
}

export interface SanitizedThreadContext {
  text: string;
  aliases: MailAssistantAliasMap;
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const EMAIL_VALUE_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const PHONE_PATTERN = /(?:\+?\d[\d .()/-]{7,}\d)/g;
const URL_PATTERN = /https?:\/\/[^\s<]+/gi;

export function emptyAliasMap(): MailAssistantAliasMap {
  return {
    aliasesByEmail: new Map(),
    emailsByAlias: new Map(),
    names: [],
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function plainTextFromBody(body: string) {
  if (!body) return '';
  const document = new DOMParser().parseFromString(body, 'text/html');
  return (document.body.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contactsForMessage(message: Message) {
  return ([] as any[]).concat(
    message.from || [],
    message.to || [],
    message.cc || [],
    message.bcc || []
  );
}

export function buildAliasMap(messages: Message[]): MailAssistantAliasMap {
  const aliases = emptyAliasMap();

  messages.forEach((message) => {
    contactsForMessage(message).forEach((contact) => {
      addIdentity(aliases, contact && contact.email, contact && contact.name);
    });
  });

  return aliases;
}

function addIdentity(aliases: MailAssistantAliasMap, emailValue?: string, nameValue?: string) {
  const email = (emailValue || '').trim().toLowerCase();
  if (email && !aliases.aliasesByEmail.has(email)) {
    const alias = `EMAIL_${aliases.aliasesByEmail.size + 1}`;
    aliases.aliasesByEmail.set(email, alias);
    aliases.emailsByAlias.set(alias, email);
  }
  const name = (nameValue || '').trim();
  if (name.length > 1 && !aliases.names.includes(name)) aliases.names.push(name);
}

/**
 * Extends a chat-scoped alias map with contacts found in a serialized mailbox
 * tool result. This keeps aliases stable across several search / read rounds.
 */
export function addAliasesFromSerializedMail(value: string, aliases: MailAssistantAliasMap) {
  let parsed: any;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = value;
  }

  const visit = (item: any) => {
    if (typeof item === 'string') {
      const emails = item.match(EMAIL_PATTERN) || [];
      emails.forEach((email) => addIdentity(aliases, email));
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== 'object') return;

    const email = typeof item.email === 'string' ? item.email : undefined;
    const name = typeof item.name === 'string' ? item.name : undefined;
    // A plain `name` field is also used for folders and categories. Only treat
    // it as a person's name when the same object contains an email address.
    if (email) addIdentity(aliases, email, name);
    Object.keys(item).forEach((key) => visit(item[key]));
  };

  visit(parsed);
  return aliases;
}

export function redactText(value: string, aliases: MailAssistantAliasMap) {
  let redacted = value || '';

  aliases.aliasesByEmail.forEach((alias, email) => {
    redacted = redacted.replace(new RegExp(escapeRegExp(email), 'gi'), `[${alias}]`);
  });
  redacted = redacted.replace(EMAIL_PATTERN, '[EMAIL_REDACTED]');

  [...aliases.names]
    .sort((a, b) => b.length - a.length)
    .forEach((name, index) => {
      redacted = redacted.replace(
        new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi'),
        `[PERSON_${index + 1}]`
      );
    });

  return redacted.replace(URL_PATTERN, '[URL_REDACTED]').replace(PHONE_PATTERN, '[PHONE_REDACTED]');
}

export function sanitizeThreadForAI(
  thread: Thread,
  messages: Message[],
  includeMessageText: boolean,
  redactPersonalInfo = true
): SanitizedThreadContext {
  const aliases = redactPersonalInfo ? buildAliasMap(messages) : emptyAliasMap();
  const protect = (value: string) => (redactPersonalInfo ? redactText(value, aliases) : value);
  const visible = messages.filter((message) => !message.draft).slice(-10);
  const lines = [
    `Thread subject: ${protect((thread && thread.subject) || '(no subject)')}`,
    `Message count supplied: ${visible.length}`,
  ];

  visible.forEach((message, index) => {
    const fromEmail =
      message.from && message.from[0] && message.from[0].email
        ? message.from[0].email.toLowerCase()
        : '';
    const fromName = message.from && message.from[0] && message.from[0].name;
    const sender = redactPersonalInfo
      ? `[${aliases.aliasesByEmail.get(fromEmail) || 'UNKNOWN_SENDER'}]`
      : `${fromName || 'Unknown sender'}${fromEmail ? ` <${fromEmail}>` : ''}`;
    lines.push(`Message ${index + 1}: from ${sender}, date ${message.date.toISOString()}`);
    if (includeMessageText) {
      const body = protect(plainTextFromBody(message.body || '')).slice(0, 3000);
      lines.push(`Text: ${body || '(empty)'}`);
    }
  });

  return { text: lines.join('\n'), aliases };
}

export function resolveAliases(
  values: string[],
  aliases: MailAssistantAliasMap,
  allowOriginalEmailAddresses = false
) {
  return (values || [])
    .map((value) => value.replace(/^\[|\]$/g, ''))
    .map(
      (value) =>
        aliases.emailsByAlias.get(value.toUpperCase()) ||
        (allowOriginalEmailAddresses && EMAIL_VALUE_PATTERN.test(value) ? value : undefined)
    )
    .filter((value): value is string => !!value);
}
