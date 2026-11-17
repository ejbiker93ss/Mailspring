import React from 'react';
import { localized, Actions, WorkspaceStore } from 'summermail-exports';
import { Thread } from './flux/models/thread';
import { SheetDeclaration } from './flux/stores/workspace-store';
import { AppNavigationMenu } from '../internal_packages/account-sidebar/lib/components/app-navigation-menu';
import { windowsTitleBarOverlayColors, WINDOWS_TITLE_BAR_HEIGHT } from './windows-title-bar';
import MatrixChatStore from '../internal_packages/matrix-chat/lib/matrix-chat-store';
import GroupMeChatStore from '../internal_packages/matrix-chat/lib/groupme-store';
import { AppTabIcon } from './components/app-tab-icon';

type HomeTabId = 'Threads' | 'Kanban' | 'Calendar' | 'Contacts' | 'Activity' | 'Matrix' | 'GroupMe';

interface ConversationTab {
  id: string;
  kind: 'conversation';
  thread: Thread;
  title: string;
}

interface AppTabsState {
  activeId: string;
  conversations: ConversationTab[];
  rootSheets: HomeTabId[];
  matrixUnreadCount: number;
  groupMeUnreadCount: number;
}

const HOME_TABS: Array<{ id: HomeTabId; label: string }> = [
  { id: 'Threads', label: 'Mail' },
  { id: 'Kanban', label: 'Kanban' },
  { id: 'Calendar', label: 'Calendar' },
  { id: 'Contacts', label: 'Contacts' },
  { id: 'Activity', label: 'Activity' },
  { id: 'Matrix', label: 'Chat' },
  { id: 'GroupMe', label: 'GroupMe' },
];

/**
 * The app tab strip doubles as the draggable Windows title bar. Home tabs map
 * to root sheets; conversation tabs retain the Thread model so switching away
 * and back restores the exact conversation in a distraction-free workspace.
 */
export default class AppTabs extends React.Component<Record<string, never>, AppTabsState> {
  static displayName = 'AppTabs';

  private unlisteners: Array<() => void> = [];
  private appMenuButton = React.createRef<HTMLButtonElement>();
  private titleBar = React.createRef<HTMLElement>();
  private themeDisposable?: { dispose: () => void };
  private nativeColorSyncTimers: number[] = [];

  constructor(props) {
    super(props);
    this.state = {
      activeId: WorkspaceStore.rootSheet()?.id || 'Threads',
      conversations: [],
      rootSheets: this._availableRootSheets(),
      matrixUnreadCount: MatrixChatStore.unreadCount(),
      groupMeUnreadCount: GroupMeChatStore.unreadCount(),
    };
  }

  componentDidMount() {
    this.unlisteners = [
      WorkspaceStore.listen(this._onWorkspaceChange),
      Actions.setFocus.listen(this._onRegularFocus),
      Actions.openThreadInTab.listen(this._onOpenThreadInTab),
      MatrixChatStore.listen(this._onMatrixChatChange),
      GroupMeChatStore.listen(this._onGroupMeChatChange),
    ];
    this.themeDisposable = AppEnv.themes.onDidChangeActiveThemes(
      this._queueNativeWindowControlColorSync
    );
    window.addEventListener('focus', this._queueNativeWindowControlColorSync);
    this._queueNativeWindowControlColorSync();
  }

  componentWillUnmount() {
    this.unlisteners.forEach((unlisten) => unlisten());
    this.themeDisposable?.dispose();
    window.removeEventListener('focus', this._queueNativeWindowControlColorSync);
    this.nativeColorSyncTimers.forEach((timer) => window.clearTimeout(timer));
  }

  _queueNativeWindowControlColorSync = () => {
    if (process.platform !== 'win32') return;
    this.nativeColorSyncTimers.forEach((timer) => window.clearTimeout(timer));
    this.nativeColorSyncTimers = [0, 75, 300, 1000].map((delay) =>
      window.setTimeout(this._syncNativeWindowControlColors, delay)
    );
  };

  _syncNativeWindowControlColors = () => {
    if (process.platform !== 'win32') return;
    window.requestAnimationFrame(() => {
      if (!this.titleBar.current) return;
      const style = window.getComputedStyle(this.titleBar.current);
      const colors = windowsTitleBarOverlayColors(style);
      if (!colors) return;
      AppEnv.getCurrentWindow().setTitleBarOverlay({
        ...colors,
        height: WINDOWS_TITLE_BAR_HEIGHT,
      });
    });
  };

  _availableRootSheets = () =>
    HOME_TABS.filter(({ id }) => WorkspaceStore.Sheet[id]?.root).map(({ id }) => id);

  _onWorkspaceChange = () => {
    const root = WorkspaceStore.rootSheet();
    if (root === WorkspaceStore.Sheet.Conversation) {
      this.setState({ rootSheets: this._availableRootSheets() });
      return;
    }
    this.setState({
      activeId: root?.id || 'Threads',
      rootSheets: this._availableRootSheets(),
    });
  };

  _onRegularFocus = ({ collection, item }: { collection: string; item: Thread | null }) => {
    if (
      collection === 'thread' &&
      item &&
      WorkspaceStore.rootSheet() !== WorkspaceStore.Sheet.Conversation &&
      WorkspaceStore.rootSheet() !== WorkspaceStore.Sheet.Kanban
    ) {
      this.setState({ activeId: 'Threads' });
    }
  };

  _onMatrixChatChange = () => {
    this.setState({ matrixUnreadCount: MatrixChatStore.unreadCount() });
  };

  _onGroupMeChatChange = () => {
    this.setState({ groupMeUnreadCount: GroupMeChatStore.unreadCount() });
  };

  _onOpenThreadInTab = (thread: Thread) => this._openConversation(thread);

  _conversationId = (thread: Thread) => `conversation:${thread.accountId}:${thread.id}`;

  _openConversation = (thread: Thread) => {
    const id = this._conversationId(thread);
    const title = thread.subject?.trim() || localized('No Subject');
    const nextTab: ConversationTab = { id, kind: 'conversation', thread, title };
    this.setState(
      (state) => ({
        activeId: id,
        conversations: state.conversations.some((tab) => tab.id === id)
          ? state.conversations.map((tab) => (tab.id === id ? nextTab : tab))
          : [...state.conversations, nextTab],
      }),
      () => this._activateConversation(nextTab, true)
    );
  };

  _activateHome = (id: HomeTabId) => {
    const sheet = WorkspaceStore.Sheet[id] as SheetDeclaration;
    if (!sheet) return;
    Actions.selectRootSheet(sheet);
    if (id === 'Threads') {
      Actions.setFocus({ collection: 'thread', item: null });
      Actions.setCursorPosition({ collection: 'thread', item: null });
    } else if (id === 'Contacts') {
      AppEnv.mailsyncBridge.sendSyncContactsNow();
    }
    this.setState({ activeId: id });
  };

  _activateConversation = (tab: ConversationTab, showAll = false) => {
    Actions.selectRootSheet(WorkspaceStore.Sheet.Conversation);
    Actions.setCursorPosition({ collection: 'thread', item: tab.thread });
    Actions.setFocus({ collection: 'thread', item: tab.thread, usingClick: true });
    if (showAll) Actions.showAllMessagesExpanded();
    this.setState({ activeId: tab.id });
  };

  _closeConversation = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    const closingIndex = this.state.conversations.findIndex((tab) => tab.id === id);
    const conversations = this.state.conversations.filter((tab) => tab.id !== id);
    if (this.state.activeId !== id) {
      this.setState({ conversations });
      return;
    }

    const next = conversations[Math.min(closingIndex, conversations.length - 1)];
    this.setState({ conversations }, () => {
      if (next) this._activateConversation(next);
      else this._activateHome('Threads');
    });
  };

  _showApplicationMenu = () => {
    const originRect = this.appMenuButton.current?.getBoundingClientRect();
    if (!originRect) return;
    Actions.openPopover(<AppNavigationMenu />, {
      originRect,
      direction: 'down',
      fallbackDirection: 'right',
    });
  };

  _showNativeApplicationMenu = () => {
    const { applicationMenu } = require('@electron/remote').getGlobal('application');
    applicationMenu.menu.popup({});
  };

  _onHomeTabKeyDown = (event: React.KeyboardEvent, id: HomeTabId) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this._activateHome(id);
    }
  };

  _toggleMaximize = () => {
    const win = AppEnv.getCurrentWindow();
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  };

  _onTitleBarDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, [role="tab"]')) return;
    this._toggleMaximize();
  };

  _onConversationKeyDown = (event: React.KeyboardEvent, tab: ConversationTab) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this._activateConversation(tab);
    }
  };

  _unreadCountFor = (id: HomeTabId) => {
    if (id === 'Matrix') return this.state.matrixUnreadCount;
    if (id === 'GroupMe') return this.state.groupMeUnreadCount;
    return 0;
  };

  // Workspaces live in a vertical rail so the title bar only carries the
  // conversations the user has opened as tabs.
  _renderRail() {
    return (
      <nav className="app-rail" role="tablist" aria-label={localized('Workspaces')}>
        {HOME_TABS.filter(({ id }) => this.state.rootSheets.includes(id)).map(({ id, label }) => {
          const unreadCount = this._unreadCountFor(id);
          return (
            <div
              key={id}
              role="tab"
              tabIndex={0}
              aria-selected={this.state.activeId === id}
              aria-label={localized(label)}
              title={localized(label)}
              className={`app-rail-item app-rail-${id.toLowerCase()} ${
                this.state.activeId === id ? 'active' : ''
              }`}
              onClick={() => this._activateHome(id)}
              onKeyDown={(event) => this._onHomeTabKeyDown(event, id)}
            >
              <AppTabIcon id={id} />
              {unreadCount > 0 ? (
                <span
                  className="app-tab-unread-count"
                  aria-label={localized(`%@ unread chats`, unreadCount)}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              ) : null}
            </div>
          );
        })}
        <div className="app-rail-spacer" />
        <button
          type="button"
          className="app-rail-item app-rail-preferences"
          aria-label={localized('Preferences')}
          title={localized('Preferences')}
          onClick={() => Actions.openPreferences()}
        >
          <svg className="app-tab-icon" aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4" />
          </svg>
        </button>
      </nav>
    );
  }

  render() {
    return (
      <>
        {this._renderRail()}
        {this._renderTitleBar()}
      </>
    );
  }

  _renderTitleBar() {
    return (
      <header
        ref={this.titleBar}
        className="app-tab-bar"
        onDoubleClick={this._onTitleBarDoubleClick}
      >
        <button
          ref={this.appMenuButton}
          className="app-tab-menu"
          onClick={this._showApplicationMenu}
          aria-label={localized('Application menu')}
          title={localized('Application menu')}
        >
          <span className="app-mark-frame" aria-hidden="true">
            <img
              className="app-mark"
              src="summermail://account-sidebar/assets/summermail-app-icon@2x.png"
              alt=""
              draggable={false}
            />
          </span>
        </button>

        <div className="app-tabs" role="tablist" aria-label={localized('Open workspaces')}>
          {this.state.conversations.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              aria-selected={this.state.activeId === tab.id}
              className={`app-tab app-tab-conversation ${
                this.state.activeId === tab.id ? 'active' : ''
              }`}
              onClick={() => this._activateConversation(tab)}
              onKeyDown={(event) => this._onConversationKeyDown(event, tab)}
              title={tab.title}
            >
              <AppTabIcon id="Conversation" />
              <span className="app-tab-title">{tab.title}</span>
              <button
                type="button"
                className="app-tab-close"
                aria-label={localized(`Close %@`, tab.title)}
                onKeyDown={(event) => event.stopPropagation()}
                onClick={(event) => this._closeConversation(event, tab.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="app-titlebar-drag-space" />
        <button
          type="button"
          className="app-titlebar-menu"
          onClick={this._showNativeApplicationMenu}
          aria-label={localized('Application menu')}
          title={localized('Application menu')}
        >
          <span className="app-titlebar-menu-icon" aria-hidden="true" />
        </button>
      </header>
    );
  }
}
