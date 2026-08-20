const https = require('https');
import { callMailboxReadTool, isMailboxReadTool } from './mcp-mail-assistant-client';
import {
  addAliasesFromSerializedMail,
  MailAssistantAliasMap,
  redactText,
} from './mail-assistant-privacy';
import { buildMailAssistantInstructions } from './mail-assistant-system-prompt';
import { linkMailAssistantEmailReferences } from './mail-assistant-email-links';

export interface AssistantChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantToolCall {
  id: string;
  name: 'create_email_draft' | 'create_calendar_event' | 'move_threads' | 'mark_threads_read';
  arguments: Record<string, any>;
}

export interface AssistantResponse {
  text: string;
  toolCalls: AssistantToolCall[];
}

export interface AssistantAttachment {
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
  kind: 'image' | 'text';
}

export const MAX_SENT_TURNS = 20;
const MAX_TURN_CHARS = 8000;

export function buildAssistantRequestMessages(messages: AssistantChatMessage[]) {
  return messages
    .slice(-MAX_SENT_TURNS)
    .map(({ role, content }) => ({ role, content: content.slice(0, MAX_TURN_CHARS) }));
}

export function groundMoveThreadProposal(
  args: Record<string, any>,
  knownThreads: Map<string, any>,
  knownFolders: Map<string, any>,
  options: { defaultAccountId?: string; allowAllAccounts?: boolean }
) {
  const folder = knownFolders.get(args.folderId);
  if (!folder) return null;
  const threads = (Array.isArray(args.threadIds) ? args.threadIds : [])
    .map((id) => knownThreads.get(id))
    .filter(
      (thread) =>
        thread &&
        (!folder.accountId || thread.accountId === folder.accountId) &&
        (options.allowAllAccounts ||
          !options.defaultAccountId ||
          thread.accountId === options.defaultAccountId)
    )
    .slice(0, 100);
  if (!threads.length) return null;
  return {
    threadIds: threads.map((thread) => thread.id),
    folderId: folder.id,
    folderName: folder.name,
    accountId: folder.accountId || options.defaultAccountId,
    threads: threads.map((thread) => ({
      id: thread.id,
      subject: thread.subject || '(no subject)',
      accountId: thread.accountId,
    })),
  };
}

export function groundMarkReadProposal(
  args: Record<string, any>,
  knownThreads: Map<string, any>,
  options: { defaultAccountId?: string; allowAllAccounts?: boolean }
) {
  const threads = (Array.isArray(args.threadIds) ? args.threadIds : [])
    .map((id) => knownThreads.get(id))
    .filter(
      (thread) =>
        thread &&
        (options.allowAllAccounts ||
          !options.defaultAccountId ||
          thread.accountId === options.defaultAccountId)
    )
    .slice(0, 100);
  if (!threads.length) return null;
  return {
    threadIds: threads.map((thread) => thread.id),
    threads: threads.map((thread) => ({
      id: thread.id,
      subject: thread.subject || '(no subject)',
      accountId: thread.accountId,
    })),
  };
}

const TOOLS = [
  {
    type: 'function',
    name: 'mark_threads_read',
    description:
      'Propose marking known threads returned by search_mail or list_threads as read. This never changes mail immediately; Mailspring shows a confirmation card.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        threadIds: { type: 'array', items: { type: 'string' }, maxItems: 100 },
      },
      required: ['threadIds'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'move_threads',
    description:
      'Propose moving known threads returned by search_mail or list_threads to a folder returned by list_folders. This never moves mail immediately; Mailspring shows a confirmation card.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        threadIds: { type: 'array', items: { type: 'string' }, maxItems: 100 },
        folderId: { type: 'string' },
        folderName: { type: 'string' },
      },
      required: ['threadIds', 'folderId', 'folderName'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'list_accounts',
    description:
      'List the email accounts the user has allowed the local Mailspring MCP server to access.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function',
    name: 'list_folders',
    description: 'List folders and standard folder roles for one permitted email account.',
    parameters: {
      type: 'object',
      properties: { accountId: { type: 'string' } },
      required: ['accountId'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'search_mail',
    description:
      'Search permitted mailboxes. Supports from:, to:, subject:, in:, is:unread, has:attachment, before:, and after:. Use this for mailbox-wide questions and keep limit at 30 or less.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        accountId: { type: ['string', 'null'] },
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
      required: ['query', 'accountId', 'limit', 'offset'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'list_threads',
    description: 'List recent threads in a permitted account folder. Keep limit at 25 or less.',
    parameters: {
      type: 'object',
      properties: {
        folderId: { type: 'string' },
        accountId: { type: 'string' },
        limit: { type: 'number' },
        offset: { type: 'number' },
        unread: { type: ['boolean', 'null'] },
      },
      required: ['folderId', 'accountId', 'limit', 'offset', 'unread'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_thread',
    description:
      'Read a permitted thread and its message bodies after locating it with search_mail or list_threads.',
    parameters: {
      type: 'object',
      properties: { threadId: { type: 'string' } },
      required: ['threadId'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'create_email_draft',
    description:
      'Propose an email draft. Use privacy aliases such as EMAIL_1 when the mail context contains them; otherwise use original email addresses. This only opens a draft for user review and never sends it.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' } },
        cc: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'cc', 'subject', 'body'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'create_calendar_event',
    description:
      'Propose a calendar event. Set meetingProvider to teams only when the user asks for Teams or a Teams meeting link. Use privacy aliases such as EMAIL_1 when the mail context contains them; otherwise use original email addresses. The user must confirm before it is created.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'ISO 8601 date and time' },
        end: { type: 'string', description: 'ISO 8601 date and time' },
        location: { type: 'string' },
        description: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string' } },
        meetingProvider: { type: 'string', enum: ['none', 'teams'] },
      },
      required: [
        'title',
        'start',
        'end',
        'location',
        'description',
        'attendees',
        'meetingProvider',
      ],
      additionalProperties: false,
    },
  },
];

function requestJSON(
  apiKey: string,
  payload: Record<string, any>,
  signal?: AbortSignal
): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(
      {
        hostname: 'api.openai.com',
        port: 443,
        path: '/v1/responses',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (raw += chunk));
        response.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch (error) {
            reject(new Error(`OpenAI returned an unreadable response (${response.statusCode}).`));
            return;
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(
              new Error(
                parsed.error && parsed.error.message
                  ? parsed.error.message
                  : 'OpenAI request failed.'
              )
            );
            return;
          }
          resolve(parsed);
        });
      }
    );

    request.setTimeout(60000, () => request.destroy(new Error('OpenAI request timed out.')));
    request.on('error', reject);
    if (signal) {
      const abort = () => request.destroy(new Error('Request stopped.'));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
      request.on('close', () => signal.removeEventListener('abort', abort));
    }
    request.write(body);
    request.end();
  });
}

export async function summarizeMailText(options: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  signal?: AbortSignal;
}) {
  const response = await requestJSON(
    options.apiKey,
    {
      model: options.model,
      store: false,
      instructions: options.systemPrompt,
      input: [{ role: 'user', content: options.userMessage }],
      max_output_tokens: 800,
    },
    options.signal
  );
  const text = (response.output || [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('OpenAI returned an empty summary.');
  return text;
}

export async function askMailAssistant(options: {
  apiKey: string;
  model: string;
  messages: AssistantChatMessage[];
  threadContext?: string;
  redactPersonalInfo: boolean;
  aliases: MailAssistantAliasMap;
  attachments?: AssistantAttachment[];
  signal?: AbortSignal;
  defaultAccountId?: string;
  defaultAccountLabel?: string;
  allowAllAccounts?: boolean;
}): Promise<AssistantResponse> {
  const instructions = buildMailAssistantInstructions({
    context: options.threadContext,
    redactPersonalInfo: options.redactPersonalInfo,
  });
  const scopedInstructions = `${instructions} By default, mailbox reads are pinned to the focused account${
    options.defaultAccountLabel ? ` (${options.defaultAccountLabel})` : ''
  }. ${
    options.allowAllAccounts
      ? 'The user explicitly requested an all-account search for this turn.'
      : 'Do not search or discuss other accounts unless the user explicitly asks for all accounts or all mailboxes.'
  }`;
  const boundedMessages = buildAssistantRequestMessages(options.messages);
  let input: any[] = [...boundedMessages];
  const attachments = options.attachments || [];
  if (attachments.length && input.length) {
    const last = input[input.length - 1];
    const textFiles = attachments.filter((attachment) => attachment.kind === 'text');
    const imageFiles = attachments.filter((attachment) => attachment.kind === 'image');
    const textSuffix = textFiles
      .map((attachment) => {
        const decoded = Buffer.from(attachment.dataBase64, 'base64').toString('utf8');
        return `\n\nAttached file: ${attachment.name}\n\`\`\`\n${decoded.slice(0, 20000)}\n\`\`\``;
      })
      .join('');
    last.content = [
      { type: 'input_text', text: `${last.content}${textSuffix}` },
      ...imageFiles.map((attachment) => ({
        type: 'input_image',
        image_url: `data:${attachment.mimeType};base64,${attachment.dataBase64}`,
        detail: 'auto',
      })),
    ];
  }
  let response: any;
  const knownThreads = new Map<string, any>();
  const knownFolders = new Map<string, any>();

  for (let round = 0; round < 6; round++) {
    if (options.signal && options.signal.aborted) throw new Error('Request stopped.');
    response = await requestJSON(
      options.apiKey,
      {
        model: options.model,
        store: false,
        instructions: scopedInstructions,
        input,
        tools: TOOLS,
      },
      options.signal
    );

    const readCalls = (response.output || []).filter(
      (item) => item.type === 'function_call' && isMailboxReadTool(item.name)
    );
    if (!readCalls.length) break;

    const outputs = await Promise.all(
      readCalls.map(async (item) => {
        let output: string;
        try {
          const args = JSON.parse(item.arguments || '{}');
          if (item.name === 'search_mail') args.limit = Math.min(args.limit || 30, 30);
          if (item.name === 'list_threads') args.limit = Math.min(args.limit || 25, 25);
          for (const key of Object.keys(args)) if (args[key] === null) delete args[key];
          output = await callMailboxReadTool(item.name, args, {
            defaultAccountId: options.defaultAccountId,
            allowAllAccounts: options.allowAllAccounts,
          });
          try {
            const parsed = JSON.parse(output);
            if (
              item.name === 'search_mail' ||
              item.name === 'list_threads' ||
              item.name === 'get_thread'
            ) {
              (Array.isArray(parsed) ? parsed : [parsed]).forEach((thread) => {
                if (thread && thread.id) knownThreads.set(thread.id, thread);
              });
            }
            if (item.name === 'list_folders') {
              (Array.isArray(parsed) ? parsed : []).forEach((folder) => {
                if (folder && folder.id) knownFolders.set(folder.id, folder);
              });
            }
          } catch {
            // Tool errors are returned to the model below; they do not add grounding.
          }
          if (options.redactPersonalInfo) {
            addAliasesFromSerializedMail(output, options.aliases);
            output = redactText(output, options.aliases);
          }
        } catch (error) {
          output = JSON.stringify({ error: error.message || String(error) });
        }
        return {
          type: 'function_call_output',
          call_id: item.call_id,
          output: output.slice(0, 60000),
        };
      })
    );
    input = [...input, ...(response.output || []), ...outputs];
  }

  const rawText = (response.output || [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text)
    .join('\n')
    .trim();
  const text = linkMailAssistantEmailReferences(rawText, Array.from(knownThreads.values()));
  const toolCalls = (response.output || [])
    .filter(
      (item) =>
        item.type === 'function_call' &&
        (item.name === 'create_email_draft' ||
          item.name === 'create_calendar_event' ||
          item.name === 'move_threads' ||
          item.name === 'mark_threads_read')
    )
    .map((item) => {
      const args = JSON.parse(item.arguments || '{}');
      if (item.name === 'move_threads') {
        const grounded = groundMoveThreadProposal(args, knownThreads, knownFolders, options);
        if (!grounded) return null;
        return {
          id: item.call_id,
          name: item.name,
          arguments: grounded,
        };
      }
      if (item.name === 'mark_threads_read') {
        const grounded = groundMarkReadProposal(args, knownThreads, options);
        if (!grounded) return null;
        return {
          id: item.call_id,
          name: item.name,
          arguments: grounded,
        };
      }
      return { id: item.call_id, name: item.name, arguments: args };
    })
    .filter(Boolean);

  return { text, toolCalls };
}
