import React from 'react';
import { localized } from 'summermail-exports';
import MatrixChatStore, {
  MatrixMemberSummary,
  MatrixRoomSummary,
  MatrixTimelineItem,
  MatrixVerificationState,
} from './matrix-chat-store';
import MatrixLoginView from './matrix-login-view';

interface State {
  composerDraft: string;
  connectionState: ReturnType<typeof MatrixChatStore.connectionState>;
  error: string | null;
  loggedIn: boolean;
  restoring: boolean;
  room: MatrixRoomSummary | null;
  sending: boolean;
  timeline: MatrixTimelineItem[];
  verification: MatrixVerificationState | null;
  deviceVerified: boolean;
  replyTo: MatrixTimelineItem | null;
}

function formatTime(timestamp: number) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDay(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return localized('Today');
  if (date.toDateString() === yesterday.toDateString()) return localized('Yesterday');
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function initials(name: string) {
  const parts = name.replace(/^[#@]/, '').split(/\s+/).filter(Boolean);
  return ((parts[0] || '?').slice(0, 1) + (parts[1] || '').slice(0, 1)).toUpperCase();
}

export default class MatrixConversation extends React.Component<Record<string, never>, State> {
  static displayName = 'MatrixConversation';
  static containerStyles = {
    minWidth: 420,
    maxWidth: 10000,
  };

  state: State = this._stateFromStore();
  private unlisten?: () => void;
  private scroller = React.createRef<HTMLDivElement>();

  componentDidMount() {
    this.unlisten = MatrixChatStore.listen(this._onStoreChange);
    this._scrollToBottom();
  }

  componentDidUpdate(_prevProps: Record<string, never>, prevState: State) {
    if (
      prevState.timeline.length !== this.state.timeline.length ||
      prevState.room?.id !== this.state.room?.id
    ) {
      this._scrollToBottom();
    }
  }

  componentWillUnmount() {
    this.unlisten?.();
  }

  _stateFromStore(): State {
    return {
      composerDraft: MatrixChatStore.composerDraft(),
      connectionState: MatrixChatStore.connectionState(),
      error: MatrixChatStore.error(),
      loggedIn: MatrixChatStore.isLoggedIn(),
      restoring: MatrixChatStore.restoring(),
      room: MatrixChatStore.selectedRoom(),
      sending: MatrixChatStore.sending(),
      timeline: MatrixChatStore.timeline(),
      verification: MatrixChatStore.verification(),
      deviceVerified: MatrixChatStore.isDeviceVerified(),
      replyTo: MatrixChatStore.replyTo(),
    };
  }

  _onStoreChange = () => this.setState(this._stateFromStore());

  _scrollToBottom() {
    const node = this.scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }

  _onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void MatrixChatStore.sendMessage();
  };

  _onComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void MatrixChatStore.sendMessage();
    }
  };

  render() {
    const {
      composerDraft,
      connectionState,
      error,
      loggedIn,
      restoring,
      room,
      sending,
      timeline,
      verification,
      deviceVerified,
      replyTo,
    } = this.state;
    if (restoring || (connectionState === 'connecting' && !loggedIn)) {
      return (
        <div className="matrix-conversation matrix-conversation-status">
          <span className="matrix-chat-spinner" />
          <span>{localized('Connecting to Matrix…')}</span>
        </div>
      );
    }
    if (!loggedIn) {
      return <MatrixLoginView />;
    }
    if (!room) {
      return (
        <div className="matrix-conversation matrix-conversation-status">
          <h2>{localized('Choose a chat')}</h2>
          <p>{localized('Select a room on the left to start reading and sending messages.')}</p>
        </div>
      );
    }

    return (
      <div className="matrix-conversation">
        <header className="matrix-conversation-header">
          <div>
            <h2>{room.name}</h2>
            <span>
              {connectionState === 'reconnecting'
                ? localized('Reconnecting…')
                : localized('%@ here', MatrixChatStore.members().length)}
            </span>
          </div>
          <button type="button" className="btn" onClick={() => void MatrixChatStore.logout()}>
            {localized('Sign out')}
          </button>
        </header>

        {verification ? (
          <div
            className="matrix-verification"
            role="dialog"
            aria-label={localized('Verify this device')}
          >
            <div>
              <h3>{localized('Verify this device')}</h3>
              {verification.phase === 'comparing' ? (
                <p>
                  {localized(
                    'Compare these emojis with the other device. If they match, both sides can share encryption keys.'
                  )}
                </p>
              ) : verification.phase === 'incoming' ? (
                <p>
                  {localized(
                    'Another device wants to verify SummerMail Chat. Accept to show the emoji match.'
                  )}
                </p>
              ) : verification.phase === 'waiting' ? (
                <p>
                  {localized(
                    'This device is waiting. Open Element or another signed-in Matrix app and accept the verification request there. The emoji match will appear here afterward.'
                  )}
                </p>
              ) : (
                <p>{localized('Waiting for the other device to continue verification…')}</p>
              )}
              {verification.emojis.length ? (
                <ol className="matrix-verification-emojis">
                  {verification.emojis.map((item) => (
                    <li key={item.name}>
                      <span aria-hidden="true">{item.emoji}</span>
                      <em>{item.name}</em>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
            <div className="matrix-verification-actions">
              {verification.phase === 'incoming' ? (
                <button
                  type="button"
                  className="btn btn-emphasis"
                  onClick={() => void MatrixChatStore.acceptVerification()}
                >
                  {localized('Accept')}
                </button>
              ) : null}
              {verification.phase === 'comparing' ? (
                <button
                  type="button"
                  className="btn btn-emphasis"
                  onClick={() => void MatrixChatStore.confirmVerification()}
                >
                  {localized('They match')}
                </button>
              ) : null}
              <button
                type="button"
                className="btn"
                onClick={() => void MatrixChatStore.cancelVerification()}
              >
                {localized('Cancel')}
              </button>
            </div>
          </div>
        ) : room.encrypted && !deviceVerified ? (
          <div className="matrix-verification-hint">
            <span>
              {localized(
                'This device is new, so old encrypted messages stay locked until you verify it from Element or another Matrix app.'
              )}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => void MatrixChatStore.startDeviceVerification()}
            >
              {localized('Verify with another device')}
            </button>
          </div>
        ) : null}

        <div className="matrix-timeline" ref={this.scroller}>
          {timeline.length === 0 ? (
            <div className="matrix-timeline-empty">
              {localized('No messages in this room yet.')}
            </div>
          ) : (
            timeline.map((item, index) => {
              const previous = timeline[index - 1];
              const showDay =
                !previous ||
                new Date(previous.timestamp).toDateString() !==
                  new Date(item.timestamp).toDateString();
              if (item.kind === 'notice') {
                const sameNotice =
                  previous && previous.kind === 'notice' && previous.body === item.body && !showDay;
                if (sameNotice) return null;
                return (
                  <React.Fragment key={item.eventId}>
                    {showDay ? <div className="matrix-day">{formatDay(item.timestamp)}</div> : null}
                    <div className="matrix-notice">{item.body}</div>
                  </React.Fragment>
                );
              }
              const grouped =
                !!previous &&
                !showDay &&
                previous.kind !== 'notice' &&
                previous.senderId === item.senderId &&
                item.timestamp - previous.timestamp < 5 * 60 * 1000;
              return (
                <React.Fragment key={item.eventId}>
                  {showDay ? <div className="matrix-day">{formatDay(item.timestamp)}</div> : null}
                  <div
                    className={`matrix-message ${item.own ? 'own' : ''} ${grouped ? 'grouped' : ''} ${item.pending ? 'pending' : ''} ${item.failed ? 'failed' : ''} ${item.undecrypted ? 'undecrypted' : ''}`}
                  >
                    <span className="matrix-room-avatar" aria-hidden="true">
                      {grouped ? '' : initials(item.senderName)}
                    </span>
                    <div className="matrix-message-body">
                      {grouped ? null : (
                        <div className="matrix-message-meta">
                          <strong>{item.own ? localized('You') : item.senderName}</strong>
                          <time>{formatTime(item.timestamp)}</time>
                        </div>
                      )}
                      {item.replyTo ? (
                        <div className="matrix-reply-preview">
                          <strong>{item.replyTo.senderName}</strong>
                          <span>{item.replyTo.body}</span>
                        </div>
                      ) : null}
                      <p>{item.body}</p>
                      {item.reactions.length ? (
                        <div className="matrix-reactions">
                          {item.reactions.map((reaction) => (
                            <button
                              key={reaction.key}
                              type="button"
                              className={reaction.mine ? 'mine' : ''}
                              onClick={() =>
                                void MatrixChatStore.toggleReaction(item.eventId, reaction.key)
                              }
                            >
                              {reaction.key} {reaction.count}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="matrix-message-actions">
                      <button
                        type="button"
                        title={localized('Reply')}
                        onClick={() => MatrixChatStore.setReplyTo(item)}
                      >
                        ↩
                      </button>
                      {['👍', '❤️', '😂'].map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => void MatrixChatStore.toggleReaction(item.eventId, emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </React.Fragment>
              );
            })
          )}
        </div>

        {error && connectionState === 'error' ? (
          <div className="matrix-conversation-banner" role="status">
            {error}
          </div>
        ) : null}

        {replyTo ? (
          <div className="matrix-replying">
            <span>
              {localized('Replying to %@', replyTo.senderName)}: {replyTo.body}
            </span>
            <button type="button" className="btn" onClick={() => MatrixChatStore.setReplyTo(null)}>
              {localized('Cancel')}
            </button>
          </div>
        ) : null}
        <form className="matrix-composer" onSubmit={this._onSubmit}>
          <textarea
            aria-label={localized('Write a message')}
            placeholder={localized('Write a message')}
            rows={2}
            value={composerDraft}
            onChange={(event) => MatrixChatStore.setComposerDraft(event.target.value)}
            onKeyDown={this._onComposerKeyDown}
          />
          <button
            className="btn btn-emphasis"
            type="submit"
            disabled={sending || !composerDraft.trim()}
          >
            {localized('Send')}
          </button>
        </form>
      </div>
    );
  }
}
