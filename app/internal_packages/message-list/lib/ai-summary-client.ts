import { Message } from 'mailspring-exports';
import { buildAliasMap, redactText } from './mail-assistant-privacy';
import { summarizeMailText } from './openai-mail-assistant-client';

export const THREAD_SUMMARY_PROMPT =
  'You are a helpful assistant that summarizes email threads. Write a 1-2 sentence overview followed by 3-6 bullet points highlighting key facts, decisions, and action items. Do not invent information that is not in the messages.';

export const QUOTED_SUMMARY_PROMPT =
  'You are a helpful assistant that summarizes quoted email history. Write a concise 1-2 sentence overview of the conversation history in the quoted text, then list 2-4 key points. Do not invent information.';

function bodyToText(body: string) {
  if (!body) return '';
  const document = new DOMParser().parseFromString(body, 'text/html');
  return (document.body.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildThreadSummaryTranscript(messages: Message[], redactPersonalInfo: boolean) {
  const chronological = (messages || [])
    .filter((message) => !message.draft)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(-60);
  const aliases = redactPersonalInfo ? buildAliasMap(chronological) : null;
  const protect = (value: string) =>
    redactPersonalInfo ? redactText(value, aliases).slice(0, 20000) : value.slice(0, 20000);

  return chronological
    .map((message, index) => {
      const from = message.from && message.from[0];
      const sender = from
        ? `${from.name || 'Unknown sender'}${from.email ? ` <${from.email}>` : ''}`
        : 'Unknown sender';
      const body = bodyToText(message.body || '') || message.snippet || '(empty)';
      return [
        `--- Message ${index + 1} ---`,
        `From: ${protect(sender)}`,
        `Date: ${message.date.toISOString()}`,
        '',
        protect(body),
      ].join('\n');
    })
    .join('\n\n');
}

export async function generateThreadSummary(options: {
  apiKey: string;
  model: string;
  messages: Message[];
  redactPersonalInfo: boolean;
  inputCap: number;
  signal?: AbortSignal;
}) {
  const transcript = buildThreadSummaryTranscript(
    options.messages,
    options.redactPersonalInfo
  ).slice(0, options.inputCap);
  return summarizeMailText({
    apiKey: options.apiKey,
    model: options.model,
    systemPrompt: THREAD_SUMMARY_PROMPT,
    userMessage: transcript,
    signal: options.signal,
  });
}

export async function generateQuotedSummary(options: {
  apiKey: string;
  model: string;
  quoteText: string;
  subject?: string;
  redactPersonalInfo: boolean;
  inputCap: number;
  signal?: AbortSignal;
}) {
  let userMessage = `Subject: ${options.subject || '(no subject)'}\n\nQuoted history:\n${
    options.quoteText
  }`;
  if (options.redactPersonalInfo) {
    userMessage = redactText(userMessage, {
      aliasesByEmail: new Map(),
      emailsByAlias: new Map(),
      names: [],
    });
  }
  return summarizeMailText({
    apiKey: options.apiKey,
    model: options.model,
    systemPrompt: QUOTED_SUMMARY_PROMPT,
    userMessage: userMessage.slice(0, options.inputCap),
    signal: options.signal,
  });
}
