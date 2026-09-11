import React from 'react';
import { DOMUtils, localized } from 'summermail-exports';
import MatrixChatStore, { MatrixRoomSummary } from './matrix-chat-store';
import GroupMeChatStore from './groupme-store';

interface State {
  rooms: MatrixRoomSummary[];
  searchQuery: string;
  selectedRoomId: string | null;
}

function initials(name: string) {
  const parts = name.replace(/^[#@]/, '').split(/\s+/).filter(Boolean);
  return ((parts[0] || '?').slice(0, 1) + (parts[1] || '').slice(0, 1)).toUpperCase();
}

export default class MatrixRoomList extends React.Component<Record<string, never>, State> {
  static displayName = 'MatrixRoomList';
  static containerStyles = {
    minWidth: DOMUtils.getWorkspaceCssNumberProperty('account-sidebar-min-width', 220),
    maxWidth: DOMUtils.getWorkspaceCssNumberProperty('account-sidebar-max-width', 320),
  };

  state: State = {
    rooms: MatrixChatStore.rooms(),
    searchQuery: MatrixChatStore.searchQuery(),
    selectedRoomId: MatrixChatStore.selectedRoomId(),
  };

  componentDidMount() {
    this.unlisten = MatrixChatStore.listen(this._onStoreChange);
  }

  componentWillUnmount() {
    this.unlisten?.();
  }

  private unlisten?: () => void;

  _onStoreChange = () => {
    this.setState({
      rooms: MatrixChatStore.rooms(),
      searchQuery: MatrixChatStore.searchQuery(),
      selectedRoomId: MatrixChatStore.selectedRoomId(),
    });
  };

  render() {
    const { rooms, searchQuery, selectedRoomId } = this.state;
    const query = searchQuery.trim().toLowerCase();
    const visible = query
      ? rooms.filter(
          (room) =>
            room.name.toLowerCase().includes(query) ||
            room.lastMessage.toLowerCase().includes(query)
        )
      : rooms;
    const people = visible.filter((room) => room.isDirect);
    const groups = visible.filter((room) => !room.isDirect);
    return (
      <div className="matrix-room-list">
        <div className="matrix-room-list-header">
          <h2>{localized('Chats')}</h2>
          <span>{MatrixChatStore.userId()}</span>
          <input
            type="search"
            value={searchQuery}
            placeholder={localized('Search chats')}
            onChange={(event) => MatrixChatStore.setSearchQuery(event.target.value)}
          />
          {AppEnv.config.get('groupme-chat.enabled') === true ? null : (
            <button
              type="button"
              className="btn matrix-connect-groupme"
              onClick={() => GroupMeChatStore.openFromChatArea()}
            >
              {localized('Connect GroupMe')}
            </button>
          )}
        </div>
        {visible.length === 0 ? (
          <div className="matrix-room-empty">{localized('No chats match that search.')}</div>
        ) : (
          <ul>
            {people.length ? <li className="matrix-room-section">{localized('People')}</li> : null}
            {people.map((room) => this._roomButton(room, selectedRoomId))}
            {groups.length ? <li className="matrix-room-section">{localized('Rooms')}</li> : null}
            {groups.map((room) => this._roomButton(room, selectedRoomId))}
          </ul>
        )}
      </div>
    );
  }

  _roomButton(room: MatrixRoomSummary, selectedRoomId: string | null) {
    return (
      <li key={room.id}>
        <button
          type="button"
          className={room.id === selectedRoomId ? 'selected' : ''}
          onClick={() => MatrixChatStore.selectRoom(room.id)}
        >
          <span className="matrix-room-avatar-wrap">
            <span className="matrix-room-avatar" aria-hidden="true">
              {initials(room.name)}
            </span>
            {room.isDirect ? (
              <span
                className={`matrix-presence ${room.presence || 'unknown'}`}
                aria-hidden="true"
              />
            ) : null}
          </span>
          <span className="matrix-room-copy">
            <span className="matrix-room-name">{room.name}</span>
            <span className="matrix-room-preview">{room.lastMessage}</span>
          </span>
          {room.unreadCount > 0 ? (
            <span className="matrix-room-unread">
              {room.unreadCount > 99 ? '99+' : room.unreadCount}
            </span>
          ) : null}
        </button>
      </li>
    );
  }
}
