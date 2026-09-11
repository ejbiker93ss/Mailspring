import React from 'react';
import { DOMUtils, localized } from 'summermail-exports';
import GroupMeChatStore, { initials } from './groupme-store';
import { GroupMeChat } from './groupme-client';

function chatKey(chat: GroupMeChat) {
  return `${chat.kind}:${chat.id}`;
}

interface State {
  chats: GroupMeChat[];
  collapsed: boolean;
  hiddenChatIds: string[];
  searchQuery: string;
  selectedChatId: string | null;
  userName: string | null;
}

export default class GroupMeRoomList extends React.Component<Record<string, never>, State> {
  static displayName = 'GroupMeRoomList';
  static containerStyles = {
    minWidth: DOMUtils.getWorkspaceCssNumberProperty('account-sidebar-min-width', 220),
    maxWidth: DOMUtils.getWorkspaceCssNumberProperty('account-sidebar-max-width', 320),
  };

  state: State = {
    chats: GroupMeChatStore.chats(),
    collapsed: GroupMeChatStore.roomsCollapsed(),
    hiddenChatIds: GroupMeChatStore.hiddenChats().map(chatKey),
    searchQuery: GroupMeChatStore.searchQuery(),
    selectedChatId: GroupMeChatStore.selectedChatId(),
    userName: GroupMeChatStore.userName(),
  };

  private unlisten?: () => void;

  componentDidMount() {
    this.unlisten = GroupMeChatStore.listen(this._onStoreChange);
  }

  componentWillUnmount() {
    this.unlisten?.();
  }

  _onStoreChange = () => {
    this.setState({
      chats: GroupMeChatStore.chats(),
      collapsed: GroupMeChatStore.roomsCollapsed(),
      hiddenChatIds: GroupMeChatStore.hiddenChats().map(chatKey),
      searchQuery: GroupMeChatStore.searchQuery(),
      selectedChatId: GroupMeChatStore.selectedChatId(),
      userName: GroupMeChatStore.userName(),
    });
  };

  render() {
    const { chats, collapsed, hiddenChatIds, searchQuery, selectedChatId, userName } = this.state;
    if (collapsed) {
      return (
        <div className="matrix-room-list collapsed">
          <button
            type="button"
            className="matrix-sidebar-rail-button"
            onClick={() => GroupMeChatStore.toggleRoomsCollapsed()}
            aria-label={localized('Show chats')}
            title={localized('Show chats')}
          >
            <span className="matrix-sidebar-chevron right" aria-hidden="true" />
          </button>
        </div>
      );
    }
    const hidden = new Set(hiddenChatIds);
    const query = searchQuery.trim().toLowerCase();
    const available = chats.filter((chat) => !hidden.has(chatKey(chat)));
    const visible = (
      query
        ? available.filter(
            (chat) =>
              chat.name.toLowerCase().includes(query) ||
              chat.lastMessage.toLowerCase().includes(query)
          )
        : available
    ).sort((a, b) => b.lastMessageAt - a.lastMessageAt || a.name.localeCompare(b.name));
    return (
      <div className="matrix-room-list">
        <div className="matrix-room-list-header">
          <div className="matrix-panel-heading">
            <div>
              <h2>{localized('GroupMe')}</h2>
              <span>{userName || localized('GroupMe')}</span>
            </div>
            <button
              type="button"
              className="matrix-sidebar-toggle"
              onClick={() => GroupMeChatStore.toggleRoomsCollapsed()}
              aria-label={localized('Hide chats')}
              title={localized('Hide chats')}
            >
              <span className="matrix-sidebar-chevron left" aria-hidden="true" />
            </button>
          </div>
          <input
            type="search"
            value={searchQuery}
            placeholder={localized('Search chats')}
            onChange={(event) => GroupMeChatStore.setSearchQuery(event.target.value)}
          />
          {hiddenChatIds.length ? (
            <button
              type="button"
              className="matrix-hidden-chats-button"
              onClick={this._showHiddenChatsMenu}
            >
              {localized(
                hiddenChatIds.length === 1 ? '%@ hidden chat' : '%@ hidden chats',
                String(hiddenChatIds.length)
              )}
            </button>
          ) : null}
        </div>
        {visible.length === 0 ? (
          <div className="matrix-room-empty">
            {available.length === 0 && hiddenChatIds.length
              ? localized('All chats are hidden. Use the hidden chats menu above to restore one.')
              : localized('No chats match that search.')}
          </div>
        ) : (
          <ul>{visible.map((chat) => this._chatButton(chat, selectedChatId))}</ul>
        )}
      </div>
    );
  }

  _chatButton(chat: GroupMeChat, selectedChatId: string | null) {
    const id = chatKey(chat);
    return (
      <li key={id}>
        <button
          type="button"
          className={id === selectedChatId ? 'selected' : ''}
          onClick={() => GroupMeChatStore.selectChat(id)}
          onContextMenu={(event) => this._showChatMenu(event, chat)}
        >
          <span className="matrix-room-avatar-wrap">
            <span className="matrix-room-avatar" aria-hidden="true">
              {initials(chat.name)}
            </span>
          </span>
          <span className="matrix-room-copy">
            <span className="matrix-room-name">{chat.name}</span>
            <span className="matrix-room-preview">{chat.lastMessage}</span>
          </span>
          {chat.unreadCount > 0 ? (
            <span className="matrix-room-unread">
              {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
            </span>
          ) : null}
        </button>
      </li>
    );
  }

  _showChatMenu(event: React.MouseEvent, chat: GroupMeChat) {
    event.preventDefault();
    const label =
      chat.kind === 'group'
        ? localized('Hide group “%@”', chat.name)
        : localized('Hide chat with %@', chat.name);
    require('@electron/remote')
      .Menu.buildFromTemplate([{ label, click: () => GroupMeChatStore.hideChat(chatKey(chat)) }])
      .popup({});
  }

  _showHiddenChatsMenu = () => {
    const hiddenChats = GroupMeChatStore.hiddenChats().sort(
      (a, b) => b.lastMessageAt - a.lastMessageAt || a.name.localeCompare(b.name)
    );
    const template: any[] = hiddenChats.map((chat) => ({
      label: localized('Show %@', chat.name),
      click: () => GroupMeChatStore.showChat(chatKey(chat)),
    }));
    if (hiddenChats.length > 1) {
      template.push(
        { type: 'separator' },
        { label: localized('Show all hidden chats'), click: () => GroupMeChatStore.showAllChats() }
      );
    }
    require('@electron/remote').Menu.buildFromTemplate(template).popup({});
  };
}
