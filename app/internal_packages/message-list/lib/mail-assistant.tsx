import React from 'react';
import DOMPurify from 'dompurify';
import {
  Actions,
  AccountStore,
  Calendar,
  CategoryStore,
  ChangeFolderTask,
  ComponentRegistry,
  ContactStore,
  DatabaseStore,
  DraftFactory,
  DraftStore,
  FocusedPerspectiveStore,
  MessageStore,
  TaskFactory,
  TaskQueue,
  Thread,
  localized,
} from 'mailspring-exports';

import { createCalendarEvent } from '../../main-calendar/lib/core/calendar-helpers';
import { getMicrosoftTeamsHosts } from '../../main-calendar/lib/core/microsoft-teams-connection';
import {
  askMailAssistant,
  AssistantChatMessage,
  AssistantAttachment,
  AssistantToolCall,
} from './openai-mail-assistant-client';
import {
  INCLUDE_TEXT_CONFIG_KEY,
  MODEL_CONFIG_KEY,
  REDACT_PERSONAL_INFO_CONFIG_KEY,
  USE_THREAD_CONFIG_KEY,
  getMailAssistantAPIKey,
} from './preferences-mail-assistant';
import {
  MailAssistantAliasMap,
  addAliasesFromSerializedMail,
  emptyAliasMap,
  redactText,
  resolveAliases,
  sanitizeThreadForAI,
} from './mail-assistant-privacy';
import {
  MailAssistantConversation,
  deleteMailAssistantConversation,
  loadMailAssistantConversations,
  loadMailAssistantDraft,
  saveMailAssistantConversation,
  saveMailAssistantDraft,
} from './mail-assistant-session-store';
import {
  mailAssistantThreadHref,
  threadIdFromMailAssistantHref,
} from './mail-assistant-email-links';
import { mailAssistantDraftHTML } from './mail-assistant-draft';

const snarkdown = require('snarkdown');

interface DisplayMessage extends AssistantChatMessage {
  id: string;
  error?: boolean;
  attachments?: Array<{ name: string; mimeType: string; sizeBytes: number }>;
}

interface PendingAction extends AssistantToolCall {
  status?: 'running' | 'done' | 'cancelled' | 'error';
  error?: string;
  afterMessageId?: string;
}

const SparklesIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2l1.35 4.15L17.5 7.5l-4.15 1.35L12 13l-1.35-4.15L6.5 7.5l4.15-1.35L12 2Z" />
    <path d="M18.5 13l.85 2.65L22 16.5l-2.65.85L18.5 20l-.85-2.65L15 16.5l2.65-.85.85-2.65Z" />
    <path d="M5 14l.65 2.35L8 17l-2.35.65L5 20l-.65-2.35L2 17l2.35-.65L5 14Z" />
  </svg>
);

const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

function markdownHTML(markdown: string) {
  return DOMPurify.sanitize(snarkdown(markdown), {
    ALLOWED_TAGS: [
      'a',
      'blockquote',
      'br',
      'code',
      'del',
      'em',
      'h1',
      'h2',
      'h3',
      'h4',
      'hr',
      'li',
      'ol',
      'p',
      'pre',
      'strong',
      'ul',
    ],
    ALLOWED_ATTR: ['href', 'title'],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}

const AssistantMarkdown = ({ content }: { content: string }) => (
  <div
    className="mail-assistant-markdown"
    dangerouslySetInnerHTML={{ __html: markdownHTML(content) }}
  />
);

interface State {
  hasAPIKey: boolean;
  attachments: AssistantAttachment[];
  conversationId?: string;
  conversations: MailAssistantConversation[];
  historyOpen: boolean;
  loading: boolean;
  messages: DisplayMessage[];
  pendingActions: PendingAction[];
  prompt: string;
  threadId?: string;
}

export default class MailAssistant extends React.Component<Record<string, never>, State> {
  static displayName = 'MailAssistant';
  static containerStyles = { order: 0, minWidth: 300, maxWidth: 400, flex: 1 };

  _unsubscribe: () => void;
  _draftLifecycleUnsubscribers: Array<() => void> = [];
  _materializingDraftActionIds = new Set<string>();
  _aliases: MailAssistantAliasMap = emptyAliasMap();
  _redactPersonalInfo = true;
  _sendGeneration = 0;
  _abortController?: AbortController;
  _lastSentAttachments: AssistantAttachment[] = [];
  _promptRef = React.createRef<HTMLTextAreaElement>();

  state: State = {
    hasAPIKey: false,
    attachments: [],
    conversations: [],
    historyOpen: false,
    loading: false,
    messages: [],
    pendingActions: [],
    prompt: '',
    threadId: MessageStore.threadId(),
  };

  async componentDidMount() {
    this._unsubscribe = MessageStore.listen(this._onThreadChange);
    this._draftLifecycleUnsubscribers = [
      Actions.draftDeliverySucceeded.listen(({ headerMessageId }) =>
        this._finishEmbeddedDraft(headerMessageId, 'done')
      ),
      Actions.destroyDraft.listen((draft) =>
        this._finishEmbeddedDraft(
          typeof draft === 'string' ? draft : draft.headerMessageId,
          'cancelled'
        )
      ),
    ];
    this.setState({
      hasAPIKey: !!(await getMailAssistantAPIKey()),
      conversations: loadMailAssistantConversations(),
      prompt: loadMailAssistantDraft(),
    });
  }

  componentWillUnmount() {
    this._abortController?.abort();
    if (this._unsubscribe) this._unsubscribe();
    this._draftLifecycleUnsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  componentDidUpdate(_prevProps: Record<string, never>, prevState: State) {
    if (prevState.pendingActions === this.state.pendingActions) return;
    this.state.pendingActions
      .filter(
        (action) =>
          action.name === 'create_email_draft' &&
          !action.arguments.headerMessageId &&
          !action.status &&
          !this._materializingDraftActionIds.has(action.id)
      )
      .forEach((action) => this._upgradeDraftAction(action));
  }

  _onThreadChange = () => {
    const threadId = MessageStore.threadId();
    if (threadId !== this.state.threadId) {
      this._aliases = emptyAliasMap();
      this.setState({ threadId });
    }
  };

  _openSettings = () => Actions.switchPreferencesTab('AI Assistant');

  _toggleHistory = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    this.setState((state) => ({
      historyOpen: !state.historyOpen,
      conversations: loadMailAssistantConversations(),
    }));
  };

  _newChat = (event?: React.SyntheticEvent) => {
    event?.stopPropagation();
    this._sendGeneration += 1;
    this._abortController?.abort();
    saveMailAssistantDraft('');
    this._aliases = emptyAliasMap();
    this._lastSentAttachments = [];
    this.setState({
      attachments: [],
      conversationId: undefined,
      historyOpen: false,
      loading: false,
      messages: [],
      pendingActions: [],
      prompt: '',
    });
  };

  _stop = () => {
    this._sendGeneration += 1;
    this._abortController?.abort();
    this.setState({ loading: false });
  };

  _persist = (messages: DisplayMessage[], pendingActions: PendingAction[]) => {
    const firstUser = messages.find((message) => message.role === 'user');
    if (!firstUser) return;
    const now = Date.now();
    const existing = this.state.conversations.find(
      (conversation) => conversation.id === this.state.conversationId
    );
    const saved = saveMailAssistantConversation({
      id: existing?.id || this.state.conversationId || `chat-${now}`,
      title: existing?.title || firstUser.content,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      messages,
      actions: pendingActions.filter((action) => action.status !== 'running'),
      aliases: Object.fromEntries(this._aliases.emailsByAlias),
      redactPersonalInfo: this._redactPersonalInfo,
    });
    this.setState({
      conversationId: saved.id,
      conversations: loadMailAssistantConversations(),
    });
  };

  _openConversation = (conversation: MailAssistantConversation) => {
    this._sendGeneration += 1;
    this._abortController?.abort();
    this._lastSentAttachments = [];
    const aliases = emptyAliasMap();
    Object.entries(conversation.aliases || {}).forEach(([alias, email]) => {
      aliases.emailsByAlias.set(alias, email);
      aliases.aliasesByEmail.set(email, alias);
    });
    this._aliases = aliases;
    this._redactPersonalInfo = conversation.redactPersonalInfo !== false;
    this.setState({
      attachments: [],
      conversationId: conversation.id,
      historyOpen: false,
      loading: false,
      messages: conversation.messages,
      pendingActions: conversation.actions,
      prompt: '',
    });
  };

  _deleteConversation = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    deleteMailAssistantConversation(id);
    const conversations = loadMailAssistantConversations();
    if (this.state.conversationId === id) this._newChat();
    this.setState({ conversations });
  };

  _chooseAttachments = async () => {
    const { dialog } = require('@electron/remote');
    const fs = require('fs');
    const result = await dialog.showOpenDialog({
      title: localized('Attach files for AI'),
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: localized('Supported files'),
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'csv', 'md', 'json', 'log'],
        },
      ],
    });
    if (result.canceled) return;
    const mimeByExtension: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      txt: 'text/plain',
      csv: 'text/csv',
      md: 'text/markdown',
      json: 'application/json',
      log: 'text/plain',
    };
    const next = [...this.state.attachments];
    for (const filePath of result.filePaths.slice(0, 5 - next.length)) {
      const data: Buffer = fs.readFileSync(filePath);
      if (data.length > 5 * 1024 * 1024) {
        AppEnv.showErrorDialog(localized('Each AI attachment must be 5 MB or smaller.'));
        continue;
      }
      if (next.reduce((sum, item) => sum + item.sizeBytes, 0) + data.length > 15 * 1024 * 1024) {
        AppEnv.showErrorDialog(localized('AI attachments may total no more than 15 MB.'));
        break;
      }
      const name = filePath.split(/[\\/]/).pop();
      const extension = (name.split('.').pop() || '').toLowerCase();
      const mimeType = mimeByExtension[extension];
      if (!mimeType) continue;
      next.push({
        name,
        mimeType,
        sizeBytes: data.length,
        dataBase64: data.toString('base64'),
        kind: mimeType.startsWith('image/') ? 'image' : 'text',
      });
    }
    this.setState({ attachments: next });
  };

  _materializeDraftAction = async (
    action: AssistantToolCall,
    aliases: MailAssistantAliasMap,
    redactPersonalInfo: boolean
  ) => {
    if (action.name !== 'create_email_draft' || action.arguments.headerMessageId) return action;
    const to = resolveAliases(action.arguments.to, aliases, !redactPersonalInfo);
    const cc = resolveAliases(action.arguments.cc, aliases, !redactPersonalInfo);
    const [toContacts, ccContacts] = await Promise.all([
      ContactStore.parseContactsInString(to.join(', '), { skipNameLookup: true }),
      ContactStore.parseContactsInString(cc.join(', '), { skipNameLookup: true }),
    ]);
    const draft = await DraftFactory.createDraft({
      to: toContacts,
      cc: ccContacts,
      subject: action.arguments.subject,
      body: mailAssistantDraftHTML(action.arguments.body),
      plaintext: false,
    });
    const result = await DraftStore._finalizeAndPersistNewMessage(draft);
    return {
      ...action,
      arguments: {
        ...action.arguments,
        headerMessageId: result.headerMessageId,
      },
    };
  };

  _upgradeDraftAction = async (action: PendingAction) => {
    this._materializingDraftActionIds.add(action.id);
    this.forceUpdate();
    try {
      const upgraded = await this._materializeDraftAction(
        action,
        this._aliases,
        this._redactPersonalInfo
      );
      this.setState((state) => {
        const pendingActions = state.pendingActions.map((candidate) =>
          candidate.id === action.id ? { ...candidate, arguments: upgraded.arguments } : candidate
        );
        setTimeout(() => this._persist(state.messages, pendingActions), 0);
        return { pendingActions };
      });
    } catch (error) {
      this._updateAction(action.id, {
        status: 'error',
        error: error.message || String(error),
      });
    } finally {
      this._materializingDraftActionIds.delete(action.id);
    }
  };

  _ask = async (requestedPrompt?: string, retry = false) => {
    const prompt = (requestedPrompt || this.state.prompt).trim();
    if (!prompt || this.state.loading) return;

    const apiKey = await getMailAssistantAPIKey();
    if (!apiKey) {
      this.setState({ hasAPIKey: false });
      return;
    }

    const sentAttachments = retry ? [...this._lastSentAttachments] : [...this.state.attachments];
    const nextMessage: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: prompt,
      attachments: sentAttachments.map(({ name, mimeType, sizeBytes }) => ({
        name,
        mimeType,
        sizeBytes,
      })),
    };
    const displayMessages = retry
      ? this.state.messages.filter((message) => !message.error)
      : [...this.state.messages, nextMessage];
    this._lastSentAttachments = sentAttachments;
    const generation = ++this._sendGeneration;
    this._abortController?.abort();
    this._abortController = new AbortController();
    saveMailAssistantDraft('');
    this.setState({ attachments: [], messages: displayMessages, prompt: '', loading: true });

    try {
      let threadContext: string;
      let aliases: MailAssistantAliasMap = emptyAliasMap();
      const redactPersonalInfo = AppEnv.config.get(REDACT_PERSONAL_INFO_CONFIG_KEY) !== false;
      if (AppEnv.config.get(USE_THREAD_CONFIG_KEY) !== false && MessageStore.thread()) {
        const sanitized = sanitizeThreadForAI(
          MessageStore.thread(),
          MessageStore.items() || [],
          AppEnv.config.get(INCLUDE_TEXT_CONFIG_KEY) !== false,
          redactPersonalInfo
        );
        threadContext = sanitized.text;
        aliases = sanitized.aliases;
      }
      this._aliases = aliases;
      this._redactPersonalInfo = redactPersonalInfo;
      if (redactPersonalInfo) {
        displayMessages
          .filter((message) => message.role === 'user')
          .forEach((message) => addAliasesFromSerializedMail(message.content, aliases));
      }
      const focusedAccountId =
        (MessageStore.thread() && MessageStore.thread().accountId) ||
        FocusedPerspectiveStore.current().accountIds[0];
      const focusedAccount = focusedAccountId && AccountStore.accountForId(focusedAccountId);
      const allowAllAccounts =
        /\b(?:across|in|from|search)\s+(?:all|every)\s+(?:accounts?|mailboxes?)\b|\ball\s+(?:accounts?|mailboxes?)\b/i.test(
          prompt
        );

      const response = await askMailAssistant({
        apiKey,
        model: AppEnv.config.get(MODEL_CONFIG_KEY) || 'gpt-5.6-terra',
        messages: displayMessages
          .filter((message) => !message.error)
          .map(({ role, content }) => ({
            role,
            content: role === 'user' && redactPersonalInfo ? redactText(content, aliases) : content,
          })),
        threadContext,
        redactPersonalInfo,
        aliases,
        attachments: sentAttachments,
        signal: this._abortController.signal,
        defaultAccountId: focusedAccountId,
        defaultAccountLabel: focusedAccount && (focusedAccount.emailAddress || focusedAccount.name),
        allowAllAccounts,
      });
      if (generation !== this._sendGeneration) return;
      const toolCalls = await Promise.all(
        response.toolCalls.map((action) =>
          this._materializeDraftAction(action, aliases, redactPersonalInfo)
        )
      );
      if (generation !== this._sendGeneration) return;
      const assistantText =
        response.text ||
        (toolCalls.length ? localized('I prepared the following action for review.') : '');
      this.setState((state) => {
        const assistantMessageId = `assistant-${Date.now()}`;
        const messages = assistantText
          ? [
              ...state.messages,
              {
                id: assistantMessageId,
                role: 'assistant' as const,
                content: assistantText,
              },
            ]
          : state.messages;
        const pendingActions = [
          ...state.pendingActions,
          ...toolCalls.map((action) => ({
            ...action,
            afterMessageId: assistantMessageId,
          })),
        ];
        setTimeout(() => this._persist(messages, pendingActions), 0);
        return { loading: false, messages, pendingActions };
      });
    } catch (error) {
      if (generation !== this._sendGeneration) return;
      this.setState((state) => ({
        loading: false,
        messages: [
          ...state.messages,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: error.message || String(error),
            error: true,
          },
        ],
      }));
    }
  };

  _submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    this._ask();
  };

  _setStarter = (prompt: string) => {
    saveMailAssistantDraft(prompt);
    this.setState({ prompt }, () => this._promptRef.current?.focus());
  };

  _retry = () => {
    const lastUser = [...this.state.messages].reverse().find((message) => message.role === 'user');
    if (lastUser) this._ask(lastUser.content, true);
  };

  _onLinkClick = async (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a') as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    const threadId = threadIdFromMailAssistantHref(href);
    event.preventDefault();
    event.stopPropagation();
    if (!threadId) {
      AppEnv.windowEventHandler.openLink({ href: anchor.href, metaKey: event.metaKey });
      return;
    }
    const thread = await DatabaseStore.find<Thread>(Thread, threadId);
    if (!thread) {
      AppEnv.showErrorDialog(localized('That email is no longer available.'));
      return;
    }
    Actions.setFocus({ collection: 'thread', item: thread });
  };

  _executeAction = async (action: PendingAction) => {
    this._updateAction(action.id, { status: 'running', error: undefined });
    try {
      if (action.name === 'create_email_draft') {
        const to = resolveAliases(action.arguments.to, this._aliases, !this._redactPersonalInfo);
        const cc = resolveAliases(action.arguments.cc, this._aliases, !this._redactPersonalInfo);
        const [toContacts, ccContacts] = await Promise.all([
          ContactStore.parseContactsInString(to.join(', '), { skipNameLookup: true }),
          ContactStore.parseContactsInString(cc.join(', '), { skipNameLookup: true }),
        ]);
        const draft = await DraftFactory.createDraft({
          to: toContacts,
          cc: ccContacts,
          subject: action.arguments.subject,
          body: mailAssistantDraftHTML(action.arguments.body),
          plaintext: false,
        });
        await DraftStore._finalizeAndPersistNewMessage(draft, { popout: true });
      } else if (action.name === 'create_calendar_event') {
        const calendars = (await DatabaseStore.findAll<Calendar>(Calendar)).filter(
          (calendar) => !calendar.readOnly
        );
        const preferredAccountId = MessageStore.thread() && MessageStore.thread().accountId;
        const calendar =
          calendars.find((candidate) => candidate.accountId === preferredAccountId) || calendars[0];
        if (!calendar) throw new Error(localized('No writable calendar is available.'));

        const start = new Date(action.arguments.start);
        const end = new Date(action.arguments.end);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
          throw new Error(localized('The proposed event times are invalid.'));
        }
        const attendees = resolveAliases(
          action.arguments.attendees,
          this._aliases,
          !this._redactPersonalInfo
        ).map((email) => ({ email }));
        let teamsHostAccountId: string | undefined;
        if (action.arguments.meetingProvider === 'teams') {
          const microsoftHosts = getMicrosoftTeamsHosts(AccountStore.accounts());
          const preferredHostId = AppEnv.config.get('mailspring.teamsHostAccountId');
          const teamsHost =
            microsoftHosts.find((host) => host.id === preferredHostId) || microsoftHosts[0];
          if (!teamsHost) {
            throw new Error(
              localized(
                'Connect Microsoft Teams in AI Assistant settings before creating a meeting.'
              )
            );
          }
          teamsHostAccountId = teamsHost.id;
        }
        await createCalendarEvent({
          summary: action.arguments.title,
          start,
          end,
          isAllDay: false,
          calendarId: calendar.id,
          accountId: calendar.accountId,
          description: action.arguments.description,
          location: action.arguments.location,
          attendees,
          teamsHostAccountId,
        });
      } else if (action.name === 'move_threads') {
        const threadIds = Array.isArray(action.arguments.threadIds)
          ? action.arguments.threadIds.slice(0, 100)
          : [];
        const threads = await DatabaseStore.modelify<Thread>(Thread, threadIds);
        if (threads.length !== threadIds.length) {
          throw new Error(localized('Some proposed messages are no longer available.'));
        }
        if (
          action.arguments.accountId &&
          threads.some((thread) => thread.accountId !== action.arguments.accountId)
        ) {
          throw new Error(
            localized('The proposed messages no longer match the destination account.')
          );
        }
        const tasks = TaskFactory.tasksForThreadsByAccountId(
          threads,
          (accountThreads, accountId) => {
            const folder = CategoryStore.byId(accountId, action.arguments.folderId);
            if (!folder) return null;
            return new ChangeFolderTask({
              threads: accountThreads,
              folder,
              source: 'AI Assistant',
            });
          }
        ).filter(Boolean);
        if (!tasks.length) {
          throw new Error(localized('The destination folder is no longer available.'));
        }
        tasks.forEach((task) => Actions.queueTask(task));
        await Promise.all(tasks.map((task) => TaskQueue.waitForPerformRemote(task)));
      } else if (action.name === 'mark_threads_read') {
        const threadIds = Array.isArray(action.arguments.threadIds)
          ? action.arguments.threadIds.slice(0, 100)
          : [];
        const threads = await DatabaseStore.modelify<Thread>(Thread, threadIds);
        if (!threadIds.length || threads.length !== threadIds.length) {
          throw new Error(localized('Some proposed messages are no longer available.'));
        }
        const task = TaskFactory.taskForSettingUnread({
          threads,
          unread: false,
          source: 'AI Assistant',
        });
        Actions.queueTask(task);
        await TaskQueue.waitForPerformRemote(task);
      } else if (action.name === 'trash_threads') {
        const threadIds = Array.isArray(action.arguments.threadIds)
          ? action.arguments.threadIds.slice(0, 100)
          : [];
        const threads = await DatabaseStore.modelify<Thread>(Thread, threadIds);
        if (!threadIds.length || threads.length !== threadIds.length) {
          throw new Error(localized('Some proposed messages are no longer available.'));
        }
        const tasks = TaskFactory.tasksForMovingToTrash({
          threads,
          source: 'AI Assistant',
        });
        if (!tasks.length) {
          throw new Error(localized('No Trash folder is available for these messages.'));
        }
        tasks.forEach((task) => Actions.queueTask(task));
        await Promise.all(tasks.map((task) => TaskQueue.waitForPerformRemote(task)));
      }
      this._updateAction(action.id, { status: 'done' });
    } catch (error) {
      this._updateAction(action.id, { status: 'error', error: error.message || String(error) });
    }
  };

  _updateAction(id: string, update: Partial<PendingAction>) {
    this.setState((state) => {
      const pendingActions = state.pendingActions.map((action) =>
        action.id === id ? { ...action, ...update } : action
      );
      setTimeout(() => this._persist(state.messages, pendingActions), 0);
      return { pendingActions };
    });
  }

  _finishEmbeddedDraft(
    headerMessageId: string,
    status: Extract<PendingAction['status'], 'done' | 'cancelled'>
  ) {
    const action = this.state.pendingActions.find(
      (candidate) =>
        candidate.name === 'create_email_draft' &&
        candidate.arguments.headerMessageId === headerMessageId
    );
    if (action) this._updateAction(action.id, { status });
  }

  _actionSummary(action: PendingAction) {
    if (action.name === 'create_email_draft') {
      return `${localized('Draft email')} · ${action.arguments.subject}`;
    }
    if (action.name === 'move_threads') {
      return `${localized('Move messages')} · ${action.arguments.folderName}`;
    }
    if (action.name === 'mark_threads_read') {
      const count = (action.arguments.threadIds || []).length;
      return count === 1
        ? localized('Mark 1 message as read')
        : localized(`Mark %@ messages as read`, count);
    }
    if (action.name === 'trash_threads') {
      const count = (action.arguments.threadIds || []).length;
      return count === 1 ? localized('Delete 1 message') : localized(`Delete %@ messages`, count);
    }
    return `${localized('Calendar event')} · ${action.arguments.title}`;
  }

  _renderAction(action: PendingAction) {
    const hasEmbeddedDraft =
      action.name === 'create_email_draft' && !!action.arguments.headerMessageId;
    const showEmbeddedDraft = hasEmbeddedDraft && !action.status;
    const isMaterializingDraft = this._materializingDraftActionIds.has(action.id);
    const Composer = showEmbeddedDraft
      ? ComponentRegistry.findComponentsMatching({ role: 'Composer' })[0]
      : null;
    return (
      <div
        className={`mail-assistant-action${
          hasEmbeddedDraft ? ' mail-assistant-action-embedded-draft' : ''
        }`}
        key={action.id}
      >
        <strong>{this._actionSummary(action)}</strong>
        {showEmbeddedDraft && Composer && (
          <div className="mail-assistant-inline-composer">
            <div className="mail-assistant-inline-composer-label">
              {localized('AI draft')} · {localized('Edit and send without leaving this chat')}
            </div>
            <Composer
              headerMessageId={action.arguments.headerMessageId}
              className="mail-assistant-composer"
              mode="inline"
            />
          </div>
        )}
        {showEmbeddedDraft && !Composer && (
          <div className="mail-assistant-action-error">
            {localized('The composer is not available.')}
          </div>
        )}
        {action.name === 'create_email_draft' && !hasEmbeddedDraft && (
          <p>{action.arguments.body}</p>
        )}
        {isMaterializingDraft && <span>{localized('Preparing composer…')}</span>}
        {action.name === 'create_calendar_event' && (
          <div>
            <p>
              {action.arguments.start} – {action.arguments.end}
            </p>
            {action.arguments.meetingProvider === 'teams' && (
              <p>
                {localized('Microsoft Teams meeting')} ·{' '}
                {(
                  getMicrosoftTeamsHosts(AccountStore.accounts()).find(
                    (host) => host.id === AppEnv.config.get('mailspring.teamsHostAccountId')
                  ) || getMicrosoftTeamsHosts(AccountStore.accounts())[0]
                )?.emailAddress || localized('Microsoft connection required')}
              </p>
            )}
          </div>
        )}
        {action.name === 'move_threads' && (
          <div className="mail-assistant-move-list">
            {(action.arguments.threads || []).map((thread) => (
              <div key={thread.id}>
                <a href={mailAssistantThreadHref(thread.id)}>{thread.subject}</a>
              </div>
            ))}
          </div>
        )}
        {(action.name === 'mark_threads_read' || action.name === 'trash_threads') && (
          <div className="mail-assistant-move-list">
            {(action.arguments.threads || []).map((thread) => (
              <div key={thread.id}>
                <a href={mailAssistantThreadHref(thread.id)}>{thread.subject}</a>
              </div>
            ))}
          </div>
        )}
        {action.error && <div className="mail-assistant-action-error">{action.error}</div>}
        {!action.status && !hasEmbeddedDraft && !isMaterializingDraft && (
          <div>
            <button className="btn btn-emphasis" onClick={() => this._executeAction(action)}>
              {localized('Confirm')}
            </button>
            <button
              className="btn"
              onClick={() => this._updateAction(action.id, { status: 'cancelled' })}
            >
              {localized('Cancel')}
            </button>
          </div>
        )}
        {action.status === 'running' && <span>{localized('Working…')}</span>}
        {action.status === 'done' && <span>{localized('Done')}</span>}
        {action.status === 'cancelled' && <span>{localized('Cancelled')}</span>}
        {action.status === 'error' && (
          <button
            className="btn btn-emphasis"
            onClick={() => {
              if (action.name === 'create_email_draft' && !action.arguments.headerMessageId) {
                this._updateAction(action.id, { status: undefined, error: undefined });
              } else {
                this._executeAction(action);
              }
            }}
          >
            {localized('Retry')}
          </button>
        )}
      </div>
    );
  }

  render() {
    return (
      <aside
        className="mail-assistant"
        aria-label={localized('AI Mail Assistant')}
        onClick={this._onLinkClick}
      >
        <header className="mail-assistant-header">
          <span className="mail-assistant-header-icon">
            <SparklesIcon />
          </span>
          <strong>{localized('Ask Mailspring')}</strong>
          <span className="mail-assistant-private">{localized('Focused account')}</span>
          <button
            type="button"
            className="mail-assistant-header-button"
            title={localized('Chat history')}
            aria-label={localized('Chat history')}
            onClick={this._toggleHistory}
          >
            ◷
          </button>
          <button
            type="button"
            className="mail-assistant-header-button"
            title={localized('New chat')}
            aria-label={localized('New chat')}
            onClick={this._newChat}
          >
            ＋
          </button>
        </header>

        {!this.state.hasAPIKey ? (
          <div className="mail-assistant-welcome mail-assistant-setup">
            <span className="mail-assistant-sparkle-mark">
              <SparklesIcon />
            </span>
            <h2>{localized('Bring AI to your inbox')}</h2>
            <p>{localized('Add your OpenAI API key in Settings to summarize and draft safely.')}</p>
            <button className="btn btn-emphasis" onClick={this._openSettings}>
              {localized('Open Settings')}
            </button>
          </div>
        ) : (
          <>
            {this.state.historyOpen && (
              <div className="mail-assistant-history">
                <div className="mail-assistant-history-title">
                  <strong>{localized('Recent chats')}</strong>
                  <button type="button" onClick={() => this.setState({ historyOpen: false })}>
                    ×
                  </button>
                </div>
                {this.state.conversations.length === 0 ? (
                  <p>{localized('No saved chats yet.')}</p>
                ) : (
                  this.state.conversations.map((conversation) => (
                    <button
                      type="button"
                      className="mail-assistant-history-row"
                      key={conversation.id}
                      onClick={() => this._openConversation(conversation)}
                    >
                      <span>
                        <strong>{conversation.title}</strong>
                        <small>{new Date(conversation.updatedAt).toLocaleString()}</small>
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        title={localized('Delete chat')}
                        onClick={(event) => this._deleteConversation(event, conversation.id)}
                      >
                        ×
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
            <div className="mail-assistant-messages" aria-live="polite">
              {this.state.messages.length === 0 && (
                <div className="mail-assistant-welcome">
                  <span className="mail-assistant-sparkle-mark">
                    <SparklesIcon />
                  </span>
                  <h2>{localized('What can I help with?')}</h2>
                  <div className="mail-assistant-suggestions">
                    <button
                      type="button"
                      onClick={() =>
                        this._setStarter(
                          'In the account I am currently viewing, what needs a reply?'
                        )
                      }
                    >
                      {localized('What needs a reply?')}
                    </button>
                    <button
                      type="button"
                      onClick={() => this._setStarter("Summarize today's emails in this account")}
                    >
                      {localized("Summarize today's emails")}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        this._setStarter(
                          'In this account, find deadlines, decisions, and follow-ups I should know about'
                        )
                      }
                    >
                      {localized('Find deadlines and follow-ups')}
                    </button>
                  </div>
                </div>
              )}
              {this.state.messages.map((message) => (
                <React.Fragment key={message.id}>
                  <div
                    className={`mail-assistant-message ${message.role} ${
                      message.error ? 'error' : ''
                    }`}
                  >
                    {message.role === 'assistant' ? (
                      <>
                        <AssistantMarkdown content={message.content} />
                        {message.error && (
                          <button type="button" className="btn" onClick={this._retry}>
                            {localized('Retry')}
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {message.content}
                        {!!message.attachments?.length && (
                          <div className="mail-assistant-message-attachments">
                            {message.attachments.map((attachment) => (
                              <span key={`${message.id}-${attachment.name}`}>
                                {attachment.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {this.state.pendingActions
                    .filter((action) => action.afterMessageId === message.id)
                    .map((action) => this._renderAction(action))}
                </React.Fragment>
              ))}
              {this.state.pendingActions
                .filter((action) => !action.afterMessageId)
                .map((action) => this._renderAction(action))}
              {this.state.loading && (
                <div className="mail-assistant-thinking" aria-label={localized('Thinking…')}>
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>
            <form className="mail-assistant-input" onSubmit={this._submit}>
              {!!this.state.attachments.length && (
                <div className="mail-assistant-attachment-tray">
                  {this.state.attachments.map((attachment, index) => (
                    <span key={`${attachment.name}-${index}`}>
                      {attachment.name}
                      <button
                        type="button"
                        aria-label={localized('Remove attachment')}
                        onClick={() =>
                          this.setState((state) => ({
                            attachments: state.attachments.filter(
                              (_, itemIndex) => itemIndex !== index
                            ),
                          }))
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="mail-assistant-input-row">
                <button
                  type="button"
                  className="mail-assistant-attach"
                  aria-label={localized('Attach files')}
                  title={localized('Attach files')}
                  disabled={this.state.loading || this.state.attachments.length >= 5}
                  onClick={this._chooseAttachments}
                >
                  ＋
                </button>
                <textarea
                  ref={this._promptRef}
                  aria-label={localized('Message AI Assistant')}
                  placeholder={localized('Ask about your mail…')}
                  value={this.state.prompt}
                  onChange={(event) => {
                    saveMailAssistantDraft(event.target.value);
                    this.setState({ prompt: event.target.value });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      this._submit();
                    }
                  }}
                />
                {this.state.loading ? (
                  <button
                    className="mail-assistant-send mail-assistant-stop"
                    type="button"
                    aria-label={localized('Stop')}
                    onClick={this._stop}
                  >
                    <span />
                  </button>
                ) : (
                  <button
                    className="mail-assistant-send"
                    type="submit"
                    aria-label={localized('Send')}
                    disabled={!this.state.prompt.trim()}
                  >
                    <SendIcon />
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </aside>
    );
  }
}
