import React from 'react';
import { localized, Actions, WorkspaceStore } from 'mailspring-exports';
import { Thread } from './flux/models/thread';
import { SheetDeclaration } from './flux/stores/workspace-store';
import { AppNavigationMenu } from '../internal_packages/account-sidebar/lib/components/app-navigation-menu';

type HomeTabId = 'Threads' | 'Kanban' | 'Calendar' | 'Contacts' | 'Activity';

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
}

const HOME_TABS: Array<{ id: HomeTabId; label: string }> = [
  { id: 'Threads', label: 'Mail' },
  { id: 'Kanban', label: 'Kanban' },
  { id: 'Calendar', label: 'Calendar' },
  { id: 'Contacts', label: 'Contacts' },
  { id: 'Activity', label: 'Activity' },
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

  constructor(props) {
    super(props);
    this.state = {
      activeId: WorkspaceStore.rootSheet()?.id || 'Threads',
      conversations: [],
      rootSheets: this._availableRootSheets(),
    };
  }

  componentDidMount() {
    this.unlisteners = [
      WorkspaceStore.listen(this._onWorkspaceChange),
      Actions.setFocus.listen(this._onRegularFocus),
      Actions.openThreadInTab.listen(this._onOpenThreadInTab),
    ];
    this.themeDisposable = AppEnv.themes.onDidChangeActiveThemes(
      this._syncNativeWindowControlColors
    );
    this._syncNativeWindowControlColors();
  }

  componentWillUnmount() {
    this.unlisteners.forEach((unlisten) => unlisten());
    this.themeDisposable?.dispose();
  }

  _syncNativeWindowControlColors = () => {
    if (process.platform !== 'win32') return;
    window.requestAnimationFrame(() => {
      if (!this.titleBar.current) return;
      const style = window.getComputedStyle(this.titleBar.current);
      AppEnv.getCurrentWindow().setTitleBarOverlay({
        color: style.backgroundColor,
        symbolColor: style.color,
        height: 40,
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

  _composeNewMessage = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    Actions.composeNewBlankDraft();
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

  render() {
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
          <span className="app-mark" aria-hidden="true">
            ✉
          </span>
        </button>

        <div className="app-tabs" role="tablist" aria-label={localized('Open workspaces')}>
          {HOME_TABS.filter(({ id }) => this.state.rootSheets.includes(id)).map(({ id, label }) => (
            <div
              key={id}
              role="tab"
              tabIndex={0}
              aria-selected={this.state.activeId === id}
              className={`app-tab app-tab-${id.toLowerCase()} ${
                this.state.activeId === id ? 'active' : ''
              }`}
              onClick={() => this._activateHome(id)}
              onKeyDown={(event) => this._onHomeTabKeyDown(event, id)}
            >
              <span className="app-tab-icon" aria-hidden="true" />
              <span className="app-tab-title">{localized(label)}</span>
              {id === 'Threads' ? (
                <button
                  type="button"
                  className="app-tab-compose"
                  title={localized('Compose new message')}
                  aria-label={localized('Compose new message')}
                  onClick={this._composeNewMessage}
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20">
                    <path d="M4 14.5V17h2.5L15 8.5 11.5 5 4 12.5v2Z" />
                    <path d="m12.5 4 1.75-1.75a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L16 7.5" />
                  </svg>
                </button>
              ) : null}
            </div>
          ))}

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
              <span className="app-tab-icon" aria-hidden="true" />
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
      </header>
    );
  }
}
