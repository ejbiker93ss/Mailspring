import {
  AccountStore,
  Actions,
  CategoryStore,
  DatabaseStore,
  Message,
  SearchQueryParser,
  Thread,
} from 'summermail-exports';
import {
  checkAccountAccess,
  checkFolderAccess,
  getAllowedAccountIds,
  isFolderAllowed,
  isMessageAllowed,
  isThreadAllowed,
} from '../../mcp-server/lib/mcp-access-control';
import {
  serializeThreadDetail,
  serializeThreadSummary,
} from '../../mcp-server/lib/mcp-serializers';
import { mailAssistantThreadHref } from './mail-assistant-email-links';

export const MAILBOX_READ_TOOL_NAMES = [
  'list_accounts',
  'list_folders',
  'search_mail',
  'list_threads',
  'get_thread',
] as const;

export type MailboxReadToolName = (typeof MAILBOX_READ_TOOL_NAMES)[number];

export type MailboxReadScope = {
  defaultAccountId?: string;
  allowAllAccounts?: boolean;
  hydrationBudget?: { remaining: number };
};

const SEARCH_PAGE_SIZE = 30;
const THREAD_MESSAGE_LIMIT = 100;
const THREAD_HYDRATION_LIMIT = 3;
const HYDRATION_POLL_ATTEMPTS = 6;
const HYDRATION_POLL_INTERVAL_MS = 500;

async function hydrateThreadMessages(messages: Message[], scope: MailboxReadScope) {
  const pending = messages
    .filter(isMessageAllowed)
    .filter(
      (message) =>
        message.body === null || (message.smHasAttachments && !message.smAttachmentHydratedV1)
    )
    .slice(
      0,
      Math.min(THREAD_HYDRATION_LIMIT, scope.hydrationBudget?.remaining ?? THREAD_HYDRATION_LIMIT)
    );
  if (!pending.length) return messages;

  if (scope.hydrationBudget) scope.hydrationBudget.remaining -= pending.length;
  Actions.fetchBodies(pending);
  // Only hydrate this selected thread. Slow/offline messages stay explicitly
  // pending; an empty attachment list is not proof that no attachment exists.
  for (let attempt = 0; attempt < HYDRATION_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, HYDRATION_POLL_INTERVAL_MS));
    const refreshed = await DatabaseStore.findAll<Message>(Message)
      .where({ id: pending.map((message) => message.id) })
      .include(Message.attributes.body)
      .background();
    const byId = new Map(refreshed.map((message) => [message.id, message]));
    messages = messages.map((message) => byId.get(message.id) || message);
    if (
      refreshed.length === pending.length &&
      refreshed.every(
        (message) =>
          message.body !== null && (!message.smHasAttachments || message.smAttachmentHydratedV1)
      )
    )
      break;
  }
  return messages;
}

export function isMailboxReadTool(name: string): name is MailboxReadToolName {
  return (MAILBOX_READ_TOOL_NAMES as readonly string[]).includes(name);
}

export function resolveMailboxToolAccountId(
  requestedAccountId: string | undefined,
  scope: { defaultAccountId?: string; allowAllAccounts?: boolean }
) {
  return scope.allowAllAccounts ? requestedAccountId : scope.defaultAccountId || requestedAccountId;
}

function json(data: unknown) {
  return JSON.stringify(data, null, 2);
}

function serializeAssistantThreadSummary(
  thread: Thread,
  opts: { includeMessageCount?: boolean } = {}
) {
  const summary = serializeThreadSummary(thread, opts);
  if (!summary) return null;
  return {
    ...summary,
    summermailLink: mailAssistantThreadHref(thread.id),
    participants: (thread.participants || []).map((contact) => ({
      name: contact.name,
      email: contact.email,
    })),
  };
}

// The in-app assistant reuses the MCP server's authorization and serialization
// boundary directly. It therefore honors the same account/folder selections
// without requiring the optional localhost HTTP server to be running.
export async function callMailboxReadTool(
  name: MailboxReadToolName,
  args: Record<string, any>,
  scope: MailboxReadScope = {}
): Promise<string> {
  const requestedAccountId = args.accountId;
  const accountId = resolveMailboxToolAccountId(requestedAccountId, scope);

  if (name === 'list_accounts') {
    const accounts = AccountStore.accounts();
    const allowed = new Set(getAllowedAccountIds(accounts.map((account) => account.id)));
    return json(
      accounts
        .filter(
          (account) =>
            allowed.has(account.id) &&
            (scope.allowAllAccounts ||
              !scope.defaultAccountId ||
              account.id === scope.defaultAccountId)
        )
        .map((account) => ({
          id: account.id,
          name: account.name,
          email: account.emailAddress,
          provider: account.provider,
        }))
    );
  }

  if (name === 'list_folders') {
    const error = checkAccountAccess(accountId);
    if (error) throw new Error(error);
    return json(
      CategoryStore.categories(accountId)
        .filter((category) => isFolderAllowed(accountId, category.id))
        .map((category) => ({
          id: category.id,
          accountId,
          name: category.displayName || category.name,
          role: (category as any).role || null,
          path: (category as any).path || category.name,
        }))
    );
  }

  if (name === 'search_mail') {
    if (accountId) {
      const error = checkAccountAccess(accountId);
      if (error) throw new Error(error);
    }
    const limit = Math.max(
      1,
      Math.min(Math.floor(Number(args.limit) || SEARCH_PAGE_SIZE), SEARCH_PAGE_SIZE)
    );
    const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
    let query = DatabaseStore.findAll<Thread>(Thread);
    if (accountId) {
      query = query.where({ accountId });
    } else {
      const allowed = getAllowedAccountIds(AccountStore.accounts().map((account) => account.id));
      query = query.where(Thread.attributes.accountId.in(allowed));
    }
    try {
      query = query.structuredSearch(SearchQueryParser.parse(args.query));
    } catch {
      query = query.search(args.query);
    }
    const threads = await query
      .order(Thread.attributes.lastMessageReceivedTimestamp.descending())
      .background()
      .offset(offset)
      .limit(limit + 1);
    return json({
      source: 'local-cache',
      coverage:
        'All dates in the local cache, not a live server search. Uncached mail may be missing.',
      accountId: accountId || null,
      query: args.query,
      nextOffset: threads.length > limit ? offset + limit : null,
      threads: threads
        .slice(0, limit)
        .map((thread) =>
          serializeAssistantThreadSummary(thread, {
            includeMessageCount: true,
          })
        )
        .filter(Boolean),
    });
  }

  if (name === 'list_threads') {
    const error = checkFolderAccess(accountId, args.folderId);
    if (error) throw new Error(error);
    let query = DatabaseStore.findAll<Thread>(Thread)
      .where([Thread.attributes.categories.contains(args.folderId)])
      .order(Thread.attributes.lastMessageReceivedTimestamp.descending())
      .offset(args.offset || 0)
      .limit(Math.min(args.limit || 25, 25));
    if (args.unread !== undefined) query = query.where({ unread: args.unread });
    const threads = await query;
    return json(threads.map((thread) => serializeAssistantThreadSummary(thread)).filter(Boolean));
  }

  const thread = await DatabaseStore.find<Thread>(Thread, args.threadId);
  if (!thread || !isThreadAllowed(thread)) throw new Error(`Thread '${args.threadId}' not found`);
  if (
    !scope.allowAllAccounts &&
    scope.defaultAccountId &&
    thread.accountId !== scope.defaultAccountId
  ) {
    throw new Error(`Thread '${args.threadId}' is outside the focused account`);
  }
  let messages = await DatabaseStore.findAll<Message>(Message, { threadId: args.threadId })
    .include(Message.attributes.body)
    .background()
    .order(Message.attributes.date.descending())
    .limit(THREAD_MESSAGE_LIMIT + 1);
  const messagesTruncated = messages.length > THREAD_MESSAGE_LIMIT;
  messages = await hydrateThreadMessages(messages.slice(0, THREAD_MESSAGE_LIMIT).reverse(), scope);
  const detail = serializeThreadDetail(thread, messages);
  if (!detail) throw new Error(`Thread '${args.threadId}' not found`);
  return json({
    ...detail,
    messagesTruncated,
    summermailLink: mailAssistantThreadHref(thread.id),
  });
}
