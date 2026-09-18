import fs from 'fs';
import path from 'path';
import React from 'react';
import {
  Account,
  AccountStore,
  Actions,
  CategoryStore,
  ChangeFolderTask,
  DatabaseStore,
  Folder,
  localized,
  Rx,
  Thread,
} from 'summermail-exports';
import { CrossAccountMoveFolderTask } from '../../../src/flux/tasks/cross-account-move-folder-task';
import MessageList from '../../message-list/lib/message-list';

const CONFIG_KEY = 'mail-kanban.lanesByAccount';
const MAX_LANES = 6;
const THREAD_LIMIT = 1000;
export const ALL_ACCOUNTS_ID = '__all-accounts__';

type LaneConfig = { id: string; folderId: string };

interface State {
  accountId: string;
  folders: Folder[];
  lanes: LaneConfig[];
  threads: Thread[];
  draggingThreadId: string | null;
  draggingSourceFolderId: string | null;
  dragOverLaneId: string | null;
  searchQuery: string;
  selectedThreadId: string | null;
}

const laneId = () => `lane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const suggestedLaneFolders = (folders: Folder[]) => {
  if (!folders.length) return [];
  const inbox = folders.find((folder) => folder.role === 'inbox');
  const done = folders.find((folder) => /(^|[\\/._ -])done($|[\\/._ -])/i.test(folder.displayName));
  const archive = folders.find((folder) => folder.role === 'archive');
  const last = done || archive;
  return [inbox, last].filter((folder, index, all) => folder && all.indexOf(folder) === index);
};

export const suggestedCombinedLaneFolders = (accounts: Account[], folders: Folder[]) => {
  const suggestions = accounts.map((account) =>
    suggestedLaneFolders(folders.filter((folder) => folder.accountId === account.id))
  );
  const inboxes = suggestions.map((foldersForAccount) => foldersForAccount[0]).filter(Boolean);
  const finishingFolders = suggestions
    .map((foldersForAccount) => foldersForAccount[1])
    .filter(Boolean);
  return [...inboxes, ...finishingFolders]
    .filter(
      (folder, index, all) => all.findIndex((candidate) => candidate.id === folder.id) === index
    )
    .slice(0, MAX_LANES);
};

const storedLanes = (): Record<string, LaneConfig[]> => AppEnv.config.get(CONFIG_KEY) || {};

export default class MailKanban extends React.Component<Record<string, never>, State> {
  static displayName = 'MailKanban';

  private accountUnlisten: (() => void) | null = null;
  private categoryUnlisten: (() => void) | null = null;
  private threadsDisposable: Rx.Disposable | null = null;

  constructor(props) {
    super(props);
    const account = AccountStore.accounts()[0];
    this.state = {
      accountId: account?.id || '',
      folders: [],
      lanes: [],
      threads: [],
      draggingThreadId: null,
      draggingSourceFolderId: null,
      dragOverLaneId: null,
      searchQuery: '',
      selectedThreadId: null,
    };
  }

  componentDidMount() {
    this.accountUnlisten = AccountStore.listen(this._onAccountsChanged);
    this.categoryUnlisten = CategoryStore.listen(this._reloadFolders);
    this._reloadFolders();
    this._subscribeToThreads();
  }

  componentWillUnmount() {
    this.accountUnlisten?.();
    this.categoryUnlisten?.();
    this.threadsDisposable?.dispose();
    if (this.state.selectedThreadId) {
      Actions.setFocus({ collection: 'thread', item: null });
    }
  }

  _accounts = () => AccountStore.accounts();

  _onAccountsChanged = () => {
    const accounts = this._accounts();
    const accountId =
      accounts.length === 0
        ? ''
        : this.state.accountId === ALL_ACCOUNTS_ID ||
            accounts.some((account) => account.id === this.state.accountId)
          ? this.state.accountId
          : accounts[0]?.id || '';
    this.setState({ accountId }, () => {
      this._reloadFolders();
      this._subscribeToThreads();
    });
  };

  _foldersForSelection = () => {
    const accountIds =
      this.state.accountId === ALL_ACCOUNTS_ID
        ? this._accounts().map((account) => account.id)
        : [this.state.accountId];
    return accountIds
      .flatMap((accountId) => CategoryStore.categories(accountId))
      .filter((category) => category instanceof Folder && category.role !== 'drafts')
      .sort((a, b) => {
        const accountOrder = accountIds.indexOf(a.accountId) - accountIds.indexOf(b.accountId);
        return accountOrder || a.displayName.localeCompare(b.displayName);
      }) as Folder[];
  };

  _reloadFolders = () => {
    if (!this.state.accountId) return;
    const folders = this._foldersForSelection();
    const saved = storedLanes()[this.state.accountId] || [];
    const validSaved = saved.filter((lane) =>
      folders.some((folder) => folder.id === lane.folderId)
    );
    const suggestedFolders =
      this.state.accountId === ALL_ACCOUNTS_ID
        ? suggestedCombinedLaneFolders(this._accounts(), folders)
        : suggestedLaneFolders(folders);
    const suggested = suggestedFolders.map((folder) => ({
      id: laneId(),
      folderId: folder.id,
    }));
    const lanes = validSaved.length ? validSaved : suggested;
    this.setState({ folders, lanes }, () => {
      if (!validSaved.length && lanes.length) this._saveLanes(lanes);
    });
  };

  _subscribeToThreads = () => {
    this.threadsDisposable?.dispose();
    if (!this.state.accountId) return;
    let query = DatabaseStore.findAll<Thread>(Thread);
    if (this.state.accountId !== ALL_ACCOUNTS_ID) {
      query = query.where({ accountId: this.state.accountId });
    }
    query = query
      .order(Thread.attributes.lastMessageReceivedTimestamp.descending())
      .limit(THREAD_LIMIT);
    this.threadsDisposable = Rx.Observable.fromQuery(query).subscribe((threads: Thread[]) =>
      this.setState({ threads })
    );
  };

  _saveLanes = (lanes: LaneConfig[]) => {
    AppEnv.config.set(CONFIG_KEY, { ...storedLanes(), [this.state.accountId]: lanes });
  };

  _setLanes = (lanes: LaneConfig[]) => this.setState({ lanes }, () => this._saveLanes(lanes));

  _changeAccount = (event: React.ChangeEvent<HTMLSelectElement>) => {
    Actions.setFocus({ collection: 'thread', item: null });
    this.setState({ accountId: event.target.value, threads: [], selectedThreadId: null }, () => {
      this._reloadFolders();
      this._subscribeToThreads();
    });
  };

  _changeLaneFolder = (laneIdValue: string, folderId: string) => {
    const lanes = this.state.lanes.map((lane) =>
      lane.id === laneIdValue ? { ...lane, folderId } : lane
    );
    this._setLanes(lanes);
  };

  _addLane = () => {
    if (this.state.lanes.length >= MAX_LANES) return;
    const selected = new Set(this.state.lanes.map((lane) => lane.folderId));
    const folder = this.state.folders.find((candidate) => !selected.has(candidate.id));
    if (!folder) return;
    this._setLanes([...this.state.lanes, { id: laneId(), folderId: folder.id }]);
  };

  _removeLane = (id: string) => this._setLanes(this.state.lanes.filter((lane) => lane.id !== id));

  _matchesSearch = (thread: Thread) => {
    const query = this.state.searchQuery.trim().toLocaleLowerCase();
    if (!query) return true;
    return [thread.subject, thread.snippet, this._participants(thread)]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(query);
  };

  _threadsForFolder = (folderId: string) =>
    this.state.threads.filter(
      (thread) =>
        (thread.folders || []).some((folder) => folder.id === folderId) &&
        this._matchesSearch(thread)
    );

  _canDropThreadOnFolder = (
    thread: Thread | undefined,
    sourceFolder: Folder | undefined,
    folder: Folder
  ) => {
    if (!thread || sourceFolder?.id === folder.id) return false;
    if (thread.accountId === folder.accountId) return true;
    return (
      this.state.accountId === ALL_ACCOUNTS_ID &&
      AppEnv.config.get('core.reading.crossAccountDragEnabled') !== false &&
      !folder.isLockedCategory()
    );
  };

  _moveThread = (threadId: string, sourceFolder: Folder | undefined, folder: Folder) => {
    const thread = this.state.threads.find((candidate) => candidate.id === threadId);
    // A conversation can span both lanes (for example, an older completed
    // message and a new Inbox reply). Destination membership must not prevent
    // moving the remaining messages out of the source lane.
    if (!this._canDropThreadOnFolder(thread, sourceFolder, folder)) {
      return;
    }
    if (thread.accountId !== folder.accountId) {
      const transfer = new CrossAccountMoveFolderTask({
        phase: 'prepare',
        threads: [thread],
        sourceAccountId: thread.accountId,
        targetAccountId: folder.accountId,
        targetFolder: folder,
        deleteFromSource:
          (AppEnv.config.get('core.reading.crossAccountDragBehavior') || 'move') === 'move',
        source: 'Mail Kanban cross-account drag and drop',
      });
      transfer.stagingDirectory = path.join(
        AppEnv.getConfigDirPath(),
        'cross-account-transfers',
        transfer.transferId
      );
      fs.mkdirSync(transfer.stagingDirectory, { recursive: true });
      Actions.queueTask(transfer);
      return;
    }
    Actions.queueTask(
      new ChangeFolderTask({
        source: 'Mail Kanban',
        threads: [thread],
        folder,
        previousFolder: sourceFolder,
      })
    );
  };

  _drop = (event: React.DragEvent, folder: Folder) => {
    event.preventDefault();
    event.stopPropagation();

    let threadId = this.state.draggingThreadId;
    let sourceFolderId = this.state.draggingSourceFolderId;
    const payload = event.dataTransfer.getData('summermail-threads-data');
    if (payload) {
      try {
        const parsed = JSON.parse(payload);
        threadId = parsed.threadIds?.[0] || threadId;
        sourceFolderId = parsed.sourceFolderId || sourceFolderId;
      } catch (error) {
        console.warn('Mail Kanban could not read the dragged thread payload.', error);
      }
    }
    threadId = event.dataTransfer.getData('text/plain') || threadId;

    const sourceFolder = this.state.folders.find((candidate) => candidate.id === sourceFolderId);
    if (threadId) this._moveThread(threadId, sourceFolder, folder);
    this.setState({
      draggingThreadId: null,
      draggingSourceFolderId: null,
      dragOverLaneId: null,
    });
  };

  _participants = (thread: Thread) =>
    (thread.participants || [])
      .slice(0, 3)
      .map((participant) => participant.name || participant.email)
      .filter(Boolean)
      .join(', ');

  _accountLabel = (accountId: string) =>
    this._accounts().find((account) => account.id === accountId)?.emailAddress || accountId;

  _folderLabel = (folder: Folder) =>
    this.state.accountId === ALL_ACCOUNTS_ID
      ? `${this._accountLabel(folder.accountId)} · ${folder.displayName}`
      : folder.displayName;

  _openPreview = (thread: Thread) => {
    this.setState({ selectedThreadId: thread.id });
    Actions.setFocus({ collection: 'thread', item: thread, usingClick: true });
  };

  _closePreview = () => {
    this.setState({ selectedThreadId: null });
    Actions.setFocus({ collection: 'thread', item: null });
  };

  _renderCard = (thread: Thread, sourceFolder: Folder) => (
    <article
      key={thread.id}
      className={`mail-kanban-card${thread.unread ? ' unread' : ''}${
        thread.id === this.state.selectedThreadId ? ' selected' : ''
      }`}
      draggable
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed =
          this.state.accountId === ALL_ACCOUNTS_ID &&
          AppEnv.config.get('core.reading.crossAccountDragEnabled') !== false
            ? 'copyMove'
            : 'move';
        event.dataTransfer.setData(
          'summermail-threads-data',
          JSON.stringify({
            threadIds: [thread.id],
            accountIds: [thread.accountId],
            sourceFolderId: sourceFolder.id,
          })
        );
        event.dataTransfer.setData(`summermail-accounts=${thread.accountId}`, '1');
        event.dataTransfer.setData('text/plain', thread.id);
        this.setState({
          draggingThreadId: thread.id,
          draggingSourceFolderId: sourceFolder.id,
        });
      }}
      onDragEnd={() =>
        this.setState({
          draggingThreadId: null,
          draggingSourceFolderId: null,
          dragOverLaneId: null,
        })
      }
      onClick={() => this._openPreview(thread)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this._openPreview(thread);
        }
      }}
      tabIndex={0}
    >
      {this.state.accountId === ALL_ACCOUNTS_ID ? (
        <div className="mail-kanban-card-account">{this._accountLabel(thread.accountId)}</div>
      ) : null}
      <div className="mail-kanban-card-subject">{thread.subject || localized('No Subject')}</div>
      <div className="mail-kanban-card-participants">{this._participants(thread)}</div>
      {thread.snippet ? <div className="mail-kanban-card-snippet">{thread.snippet}</div> : null}
      <div className="mail-kanban-card-meta">
        {thread.starred ? <span aria-label={localized('Starred')}>★</span> : <span />}
        <time>{thread.lastMessageReceivedTimestamp?.toLocaleDateString()}</time>
      </div>
    </article>
  );

  render() {
    const accounts = this._accounts();
    const selectedThread = this.state.threads.find(
      (thread) => thread.id === this.state.selectedThreadId
    );
    return (
      <section className="mail-kanban">
        <header className="mail-kanban-header">
          <div>
            <h1>{localized('Mail Kanban')}</h1>
            <p>
              {this.state.accountId === ALL_ACCOUNTS_ID
                ? localized(
                    'Drag cards between accounts. Your cross-account move or copy preference applies.'
                  )
                : localized('Drag a card to another lane to move the email to that folder.')}
            </p>
          </div>
          <div className="mail-kanban-controls">
            <label className="mail-kanban-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={this.state.searchQuery}
                onChange={(event) => this.setState({ searchQuery: event.target.value })}
                placeholder={localized('Search board')}
                aria-label={localized('Search Kanban emails')}
              />
              {this.state.searchQuery ? (
                <button
                  type="button"
                  onClick={() => this.setState({ searchQuery: '' })}
                  aria-label={localized('Clear search')}
                  title={localized('Clear search')}
                >
                  ×
                </button>
              ) : null}
            </label>
            {accounts.length > 1 ? (
              <select
                value={this.state.accountId}
                onChange={this._changeAccount}
                aria-label={localized('Account')}
              >
                <option value={ALL_ACCOUNTS_ID}>{localized('All accounts')}</option>
                {accounts.map((account: Account) => (
                  <option key={account.id} value={account.id}>
                    {account.emailAddress}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              className="btn btn-emphasis"
              onClick={this._addLane}
              disabled={
                this.state.lanes.length >= MAX_LANES ||
                this.state.lanes.length >= this.state.folders.length
              }
            >
              {localized('Add lane')} ({this.state.lanes.length}/{MAX_LANES})
            </button>
          </div>
        </header>

        {!this.state.lanes.length ? (
          <div className="mail-kanban-empty">
            {this.state.accountId === ALL_ACCOUNTS_ID
              ? localized('No mail folders are available for the selected accounts.')
              : localized('No mail folders are available for this account.')}
          </div>
        ) : (
          <div className="mail-kanban-workspace">
            <div className="mail-kanban-board">
              {this.state.lanes.map((lane) => {
                const folder = this.state.folders.find(
                  (candidate) => candidate.id === lane.folderId
                );
                if (!folder) return null;
                const threads = this._threadsForFolder(folder.id);
                return (
                  <section
                    className={`mail-kanban-lane${
                      this.state.draggingThreadId ? ' drag-active' : ''
                    }${this.state.dragOverLaneId === lane.id ? ' drag-over' : ''}`}
                    key={lane.id}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      const thread = this.state.threads.find(
                        (candidate) => candidate.id === this.state.draggingThreadId
                      );
                      const sourceFolder = this.state.folders.find(
                        (candidate) => candidate.id === this.state.draggingSourceFolderId
                      );
                      this.setState({
                        dragOverLaneId: this._canDropThreadOnFolder(thread, sourceFolder, folder)
                          ? lane.id
                          : null,
                      });
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                        this.setState({ dragOverLaneId: null });
                      }
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      const thread = this.state.threads.find(
                        (candidate) => candidate.id === this.state.draggingThreadId
                      );
                      const sourceFolder = this.state.folders.find(
                        (candidate) => candidate.id === this.state.draggingSourceFolderId
                      );
                      if (!this._canDropThreadOnFolder(thread, sourceFolder, folder)) {
                        event.dataTransfer.dropEffect = 'none';
                      } else if (thread.accountId !== folder.accountId) {
                        event.dataTransfer.dropEffect =
                          (AppEnv.config.get('core.reading.crossAccountDragBehavior') || 'move') ===
                          'copy'
                            ? 'copy'
                            : 'move';
                      } else {
                        event.dataTransfer.dropEffect = 'move';
                      }
                    }}
                    onDrop={(event) => this._drop(event, folder)}
                  >
                    <header className="mail-kanban-lane-header">
                      <select
                        value={folder.id}
                        onChange={(event) => this._changeLaneFolder(lane.id, event.target.value)}
                        aria-label={localized('Lane folder')}
                      >
                        {this.state.folders.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {this._folderLabel(candidate)}
                          </option>
                        ))}
                      </select>
                      <span className="mail-kanban-count">{threads.length}</span>
                      <button
                        className="mail-kanban-remove"
                        onClick={() => this._removeLane(lane.id)}
                        title={localized('Remove lane')}
                        aria-label={localized('Remove lane')}
                      >
                        ×
                      </button>
                    </header>
                    <div className="mail-kanban-cards">
                      {threads.length ? (
                        threads.map((thread) => this._renderCard(thread, folder))
                      ) : (
                        <div className="mail-kanban-lane-empty">
                          {this.state.searchQuery
                            ? localized('No matching emails')
                            : localized('Drop email here')}
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
            {selectedThread ? (
              <aside className="mail-kanban-preview" aria-label={localized('Email preview')}>
                <button
                  className="mail-kanban-preview-close"
                  onClick={this._closePreview}
                  title={localized('Close preview')}
                  aria-label={localized('Close preview')}
                >
                  ×
                </button>
                <MessageList />
              </aside>
            ) : null}
          </div>
        )}
      </section>
    );
  }
}
