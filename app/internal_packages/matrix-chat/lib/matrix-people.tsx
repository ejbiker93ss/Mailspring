import React from 'react';
import { localized } from 'summermail-exports';
import MatrixChatStore, { MatrixMemberSummary } from './matrix-chat-store';

function initials(name: string) {
  const parts = name.replace(/^[#@]/, '').split(/\s+/).filter(Boolean);
  return ((parts[0] || '?').slice(0, 1) + (parts[1] || '').slice(0, 1)).toUpperCase();
}

function presenceLabel(presence: MatrixMemberSummary['presence']) {
  if (presence === 'online') return localized('Online');
  if (presence === 'unavailable') return localized('Away');
  if (presence === 'offline') return localized('Offline');
  return localized('Unknown');
}

export default class MatrixPeople extends React.Component<
  Record<string, never>,
  { members: MatrixMemberSummary[] }
> {
  static displayName = 'MatrixPeople';
  static containerStyles = { minWidth: 220, maxWidth: 280 };

  state = { members: MatrixChatStore.members() };
  private unlisten?: () => void;

  componentDidMount() {
    this.unlisten = MatrixChatStore.listen(() =>
      this.setState({ members: MatrixChatStore.members() })
    );
  }

  componentWillUnmount() {
    this.unlisten?.();
  }

  render() {
    const { members } = this.state;
    return (
      <aside className="matrix-people" aria-label={localized('People')}>
        <header>
          <h2>{localized('People')}</h2>
          <span>{localized('%@ here', members.length)}</span>
        </header>
        {members.length === 0 ? (
          <div className="matrix-people-empty">
            {localized('No one is listed in this room yet.')}
          </div>
        ) : (
          <ul>
            {members.map((member) => (
              <li key={member.id}>
                <span
                  className={`matrix-presence ${member.presence || 'unknown'}`}
                  aria-hidden="true"
                />
                <span className="matrix-room-avatar" aria-hidden="true">
                  {initials(member.name)}
                </span>
                <span className="matrix-people-copy">
                  <strong>{member.name}</strong>
                  <em>{member.status || presenceLabel(member.presence)}</em>
                </span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    );
  }
}
