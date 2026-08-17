import {
  AccountStore,
  CategoryStore,
  DatabaseStore,
  Message,
  SearchQueryParser,
  Thread,
} from 'mailspring-exports';
import {
  checkAccountAccess,
  checkFolderAccess,
  getAllowedAccountIds,
  isFolderAllowed,
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
    mailspringLink: mailAssistantThreadHref(thread.id),
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
  scope: { defaultAccountId?: string; allowAllAccounts?: boolean } = {}
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
      .offset(args.offset || 0)
      .limit(Math.min(args.limit || 30, 30));
    return json(
      threads
        .map((thread) => serializeAssistantThreadSummary(thread, { includeMessageCount: true }))
        .filter(Boolean)
    );
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
  const messages = await DatabaseStore.findAll<Message>(Message, { threadId: args.threadId })
    .include(Message.attributes.body)
    .order(Message.attributes.date.ascending());
  const detail = serializeThreadDetail(thread, messages);
  if (!detail) throw new Error(`Thread '${args.threadId}' not found`);
  return json({ ...detail, mailspringLink: mailAssistantThreadHref(thread.id) });
}
