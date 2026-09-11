import React from 'react';
import { localized } from 'summermail-exports';
import GroupMeChatStore, { initials } from './groupme-store';
import { GroupMeMember } from './groupme-client';

export default class GroupMePeople extends React.Component<
  Record<string, never>,
  { collapsed: boolean; members: GroupMeMember[] }
> {
  static displayName = 'GroupMePeople';
  static containerStyles = { minWidth: 220, maxWidth: 280 };

  state = {
    collapsed: GroupMeChatStore.peopleCollapsed(),
    members: GroupMeChatStore.members(),
  };
  private unlisten?: () => void;

  componentDidMount() {
    this.unlisten = GroupMeChatStore.listen(() =>
      this.setState({
        collapsed: GroupMeChatStore.peopleCollapsed(),
        members: GroupMeChatStore.members(),
      })
    );
  }

  componentWillUnmount() {
    this.unlisten?.();
  }

  render() {
    const { collapsed, members } = this.state;
    if (collapsed) {
      return (
        <aside className="matrix-people collapsed" aria-label={localized('People')}>
          <button
            type="button"
            className="matrix-sidebar-rail-button"
            onClick={() => GroupMeChatStore.togglePeopleCollapsed()}
            aria-label={localized('Show people')}
            title={localized('Show people')}
          >
            <span className="matrix-sidebar-chevron left" aria-hidden="true" />
          </button>
        </aside>
      );
    }
    return (
      <aside className="matrix-people" aria-label={localized('People')}>
        <header>
          <div className="matrix-panel-heading">
            <div>
              <h2>{localized('People')}</h2>
              <span>{localized('%@ here', members.length)}</span>
            </div>
            <button
              type="button"
              className="matrix-sidebar-toggle"
              onClick={() => GroupMeChatStore.togglePeopleCollapsed()}
              aria-label={localized('Hide people')}
              title={localized('Hide people')}
            >
              <span className="matrix-sidebar-chevron right" aria-hidden="true" />
            </button>
          </div>
        </header>
        {members.length === 0 ? (
          <div className="matrix-people-empty">
            {localized('No one is listed in this chat yet.')}
          </div>
        ) : (
          <ul>
            {members.map((member) => (
              <li key={member.id}>
                <span className="matrix-room-avatar" aria-hidden="true">
                  {initials(member.name)}
                </span>
                <span className="matrix-people-copy">
                  <strong>{member.name}</strong>
                </span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    );
  }
}
