import React from 'react';
import { localized } from 'summermail-exports';
import GroupMeChatStore, { initials } from './groupme-store';
import {
  GROUPME_REACTION_EMOJIS,
  GroupMeChat,
  GroupMeCustomEmoji,
  GroupMeMember,
  GroupMeMention,
  GroupMeMessage,
} from './groupme-client';
import GroupMeLoginView from './groupme-login-view';

interface State {
  composerDraft: string;
  connectionState: ReturnType<typeof GroupMeChatStore.connectionState>;
  error: string | null;
  loggedIn: boolean;
  members: GroupMeMember[];
  mentionIndex: number;
  mentionRange: { end: number; query: string; start: number } | null;
  restoring: boolean;
  reactionPickerMessageId: string | null;
  replyingTo: GroupMeMessage | null;
  chat: GroupMeChat | null;
  sending: boolean;
  timeline: GroupMeMessage[];
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

function renderMessageText(
  text: string,
  mentions: GroupMeMention[],
  emoji: GroupMeCustomEmoji[] = []
) {
  if (!mentions.length && !emoji.length) return text;
  const renderEmoji = (start: number, end: number): React.ReactNode[] => {
    const result: React.ReactNode[] = [];
    let cursor = start;
    for (const item of emoji) {
      if (item.start < cursor || item.start + item.length > end) continue;
      result.push(text.slice(cursor, item.start));
      result.push(<GroupMeEmoji key={item.start} emoji={item} />);
      cursor = item.start + item.length;
    }
    result.push(text.slice(cursor, end));
    return result;
  };
  const parts: React.ReactNode[] = [];
  let offset = 0;
  mentions
    .filter((mention) => mention.start >= 0 && mention.start + mention.length <= text.length)
    .sort((a, b) => a.start - b.start)
    .forEach((mention, index) => {
      if (mention.start < offset) return;
      if (mention.start > offset) parts.push(...renderEmoji(offset, mention.start));
      parts.push(
        <span className="groupme-mention" key={`${mention.userId}-${index}`}>
          {renderEmoji(mention.start, mention.start + mention.length)}
        </span>
      );
      offset = mention.start + mention.length;
    });
  if (offset < text.length) parts.push(...renderEmoji(offset, text.length));
  return parts;
}

function GroupMeEmoji({ emoji }: { emoji: GroupMeCustomEmoji }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) return <span>{localized('[GroupMe emoji]')}</span>;
  return (
    <img
      className="groupme-custom-emoji"
      src={`https://powerups.s3.amazonaws.com/emoji/${emoji.packId}/sticker/xhdpi/${emoji.index}.png`}
      alt={localized('GroupMe emoji')}
      onError={() => setFailed(true)}
    />
  );
}

function renderReplyText(message?: GroupMeMessage) {
  return message
    ? renderMessageText(message.text, message.mentions, message.customEmoji)
    : localized('Original message');
}

export default class GroupMeConversation extends React.Component<Record<string, never>, State> {
  static displayName = 'GroupMeConversation';
  static containerStyles = {
    minWidth: 420,
    maxWidth: 10000,
  };

  state: State = {
    ...this._stateFromStore(),
    mentionIndex: 0,
    mentionRange: null,
    reactionPickerMessageId: null,
  };
  private unlisten?: () => void;
  private scroller = React.createRef<HTMLDivElement>();
  private composer = React.createRef<HTMLTextAreaElement>();

  componentDidMount() {
    this.unlisten = GroupMeChatStore.listen(this._onStoreChange);
    this._scrollToBottom();
  }

  componentDidUpdate(_prevProps: Record<string, never>, prevState: State) {
    if (
      prevState.timeline.length !== this.state.timeline.length ||
      prevState.chat?.id !== this.state.chat?.id
    ) {
      this._scrollToBottom();
    }
  }

  componentWillUnmount() {
    this.unlisten?.();
  }

  _stateFromStore(): Omit<State, 'mentionIndex' | 'mentionRange' | 'reactionPickerMessageId'> {
    return {
      composerDraft: GroupMeChatStore.composerDraft(),
      connectionState: GroupMeChatStore.connectionState(),
      error: GroupMeChatStore.error(),
      loggedIn: GroupMeChatStore.isLoggedIn(),
      members: GroupMeChatStore.members(),
      restoring: GroupMeChatStore.restoring(),
      replyingTo: GroupMeChatStore.replyingTo(),
      chat: GroupMeChatStore.selectedChat(),
      sending: GroupMeChatStore.sending(),
      timeline: GroupMeChatStore.timeline(),
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
    this.setState({ mentionRange: null });
    void GroupMeChatStore.sendMessage();
  };

  _onComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const suggestions = this._mentionSuggestions();
    if (this.state.mentionRange && suggestions.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        this.setState(({ mentionIndex }) => ({
          mentionIndex: (mentionIndex + direction + suggestions.length) % suggestions.length,
        }));
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        this._selectMention(suggestions[this.state.mentionIndex] || suggestions[0]);
        return;
      }
    }
    if (event.key === 'Escape' && this.state.mentionRange) {
      event.preventDefault();
      this.setState({ mentionRange: null });
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void GroupMeChatStore.sendMessage();
    }
  };

  _updateMention(value: string, cursor: number | null) {
    const position = cursor ?? value.length;
    const match = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, position));
    if (!match) {
      if (this.state.mentionRange) this.setState({ mentionRange: null });
      return;
    }
    this.setState({
      mentionIndex: 0,
      mentionRange: {
        end: position,
        query: match[2],
        start: position - match[2].length - 1,
      },
    });
  }

  _mentionSuggestions() {
    const range = this.state.mentionRange;
    if (!range) return [];
    const query = range.query.toLocaleLowerCase();
    return this.state.members
      .filter((member) => member.name.toLocaleLowerCase().includes(query))
      .slice(0, 8);
  }

  _selectMention(member: GroupMeMember) {
    const range = this.state.mentionRange;
    if (!range) return;
    const value = GroupMeChatStore.composerDraft();
    const insertion = `@${member.name} `;
    const next = `${value.slice(0, range.start)}${insertion}${value.slice(range.end)}`;
    const cursor = range.start + insertion.length;
    GroupMeChatStore.setComposerDraft(next);
    this.setState({ mentionIndex: 0, mentionRange: null }, () => {
      this.composer.current?.focus();
      this.composer.current?.setSelectionRange(cursor, cursor);
    });
  }

  _openMentionPicker = () => {
    const textarea = this.composer.current;
    const value = GroupMeChatStore.composerDraft();
    const cursor = textarea?.selectionStart ?? value.length;
    const needsSpace = cursor > 0 && !/\s/.test(value[cursor - 1]);
    const insertion = `${needsSpace ? ' ' : ''}@`;
    const next = `${value.slice(0, cursor)}${insertion}${value.slice(cursor)}`;
    const nextCursor = cursor + insertion.length;
    GroupMeChatStore.setComposerDraft(next);
    this.setState(
      {
        mentionIndex: 0,
        mentionRange: { end: nextCursor, query: '', start: nextCursor - 1 },
      },
      () => {
        textarea?.focus();
        textarea?.setSelectionRange(nextCursor, nextCursor);
      }
    );
  };

  render() {
    const {
      composerDraft,
      error,
      loggedIn,
      mentionIndex,
      mentionRange,
      restoring,
      reactionPickerMessageId,
      replyingTo,
      chat,
      sending,
      timeline,
    } = this.state;
    const mentionSuggestions = this._mentionSuggestions();
    if (restoring) {
      return (
        <div className="matrix-conversation matrix-conversation-status">
          <span className="matrix-chat-spinner" />
          <span>{localized('Connecting to GroupMe…')}</span>
        </div>
      );
    }
    if (!loggedIn) {
      return <GroupMeLoginView />;
    }
    if (!chat) {
      return (
        <div className="matrix-conversation matrix-conversation-status">
          <h2>{localized('Choose a chat')}</h2>
          <p>{localized('Select a GroupMe group or direct message on the left.')}</p>
        </div>
      );
    }

    return (
      <div className="matrix-conversation">
        <header className="matrix-conversation-header">
          <div>
            <h2>{chat.name}</h2>
            <span>
              {chat.kind === 'direct'
                ? localized('Direct message')
                : localized('%@ here', GroupMeChatStore.members().length)}
            </span>
          </div>
          <button type="button" className="btn" onClick={() => void GroupMeChatStore.logout()}>
            {localized('Sign out')}
          </button>
        </header>

        <div className="matrix-timeline" ref={this.scroller}>
          {timeline.length === 0 ? (
            <div className="matrix-timeline-empty">
              {localized('No messages in this chat yet.')}
            </div>
          ) : (
            timeline.map((item, index) => {
              const previous = timeline[index - 1];
              const showDay =
                !previous ||
                new Date(previous.createdAt).toDateString() !==
                  new Date(item.createdAt).toDateString();
              if (item.system) {
                return (
                  <React.Fragment key={item.id}>
                    {showDay ? <div className="matrix-day">{formatDay(item.createdAt)}</div> : null}
                    <div className="matrix-notice">{item.text}</div>
                  </React.Fragment>
                );
              }
              const own = item.senderId === GroupMeChatStore.userId();
              const grouped =
                !!previous &&
                !showDay &&
                !previous.system &&
                previous.senderId === item.senderId &&
                item.createdAt - previous.createdAt < 5 * 60 * 1000;
              return (
                <React.Fragment key={item.id}>
                  {showDay ? <div className="matrix-day">{formatDay(item.createdAt)}</div> : null}
                  <div
                    className={`matrix-message ${own ? 'own' : ''} ${grouped ? 'grouped' : ''}`}
                    data-message-id={item.id}
                  >
                    <span className="matrix-room-avatar" aria-hidden="true">
                      {grouped ? '' : initials(item.senderName)}
                    </span>
                    <div className="matrix-message-body">
                      {grouped ? null : (
                        <div className="matrix-message-meta">
                          <strong>{own ? localized('You') : item.senderName}</strong>
                          <time>{formatTime(item.createdAt)}</time>
                        </div>
                      )}
                      {item.replyToId ? (
                        <div className="matrix-reply-preview groupme-reply-preview">
                          <strong>
                            ↩{' '}
                            {timeline.find((message) => message.id === item.replyToId)
                              ?.senderName || localized('Earlier message')}
                          </strong>
                          <span>
                            {renderReplyText(
                              timeline.find((message) => message.id === item.replyToId)
                            )}
                          </span>
                        </div>
                      ) : null}
                      {item.text && item.text !== 'Image' ? (
                        <p>{renderMessageText(item.text, item.mentions, item.customEmoji)}</p>
                      ) : null}
                      {item.imageUrl ? (
                        <img className="groupme-message-image" src={item.imageUrl} alt="" />
                      ) : null}
                      {item.reactions.length ? (
                        <div className="matrix-reactions">
                          {item.reactions.map((reaction) => (
                            <button
                              key={reaction.emoji}
                              type="button"
                              className={reaction.likedByMe ? 'mine' : ''}
                              title={localized('React with %@', reaction.emoji)}
                              onClick={() =>
                                void GroupMeChatStore.setReaction(item, reaction.emoji)
                              }
                            >
                              {reaction.emoji} {reaction.count}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div
                      className={`matrix-message-actions ${
                        reactionPickerMessageId === item.id ? 'picker-open' : ''
                      }`}
                    >
                      <button
                        type="button"
                        title={localized('Reply')}
                        aria-label={localized('Reply')}
                        onClick={() => {
                          GroupMeChatStore.setReplyingTo(item);
                          this.composer.current?.focus();
                        }}
                      >
                        ↩
                      </button>
                      <button
                        type="button"
                        title={localized('Add reaction')}
                        aria-label={localized('Add reaction')}
                        aria-expanded={reactionPickerMessageId === item.id}
                        onClick={() =>
                          this.setState({
                            reactionPickerMessageId:
                              reactionPickerMessageId === item.id ? null : item.id,
                          })
                        }
                      >
                        {item.reactions.find((reaction) => reaction.likedByMe)?.emoji || '☺'}
                      </button>
                      {reactionPickerMessageId === item.id ? (
                        <div
                          className="groupme-reaction-picker"
                          role="menu"
                          aria-label={localized('Choose a reaction')}
                        >
                          {GROUPME_REACTION_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              role="menuitem"
                              title={localized('React with %@', emoji)}
                              onClick={() => {
                                this.setState({ reactionPickerMessageId: null });
                                void GroupMeChatStore.setReaction(item, emoji);
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </React.Fragment>
              );
            })
          )}
        </div>

        {error ? (
          <div className="matrix-conversation-banner" role="status">
            {error}
          </div>
        ) : null}

        {replyingTo ? (
          <div className="matrix-replying">
            <div className="matrix-replying-copy">
              <strong>{localized('Replying to %@', replyingTo.senderName)}</strong>
              <span>{replyingTo.text}</span>
            </div>
            <button
              type="button"
              aria-label={localized('Cancel reply')}
              title={localized('Cancel reply')}
              onClick={() => GroupMeChatStore.setReplyingTo(null)}
            >
              ×
            </button>
          </div>
        ) : null}

        <form className="matrix-composer" onSubmit={this._onSubmit}>
          <div className="matrix-composer-field">
            {mentionRange && mentionSuggestions.length ? (
              <div
                className="groupme-mention-picker"
                role="listbox"
                aria-label={localized('Mention a person')}
              >
                {mentionSuggestions.map((member, index) => (
                  <button
                    key={member.id}
                    type="button"
                    role="option"
                    aria-selected={index === mentionIndex}
                    className={index === mentionIndex ? 'selected' : ''}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => this._selectMention(member)}
                  >
                    <span className="matrix-room-avatar" aria-hidden="true">
                      {initials(member.name)}
                    </span>
                    <strong>{member.name}</strong>
                  </button>
                ))}
              </div>
            ) : null}
            <textarea
              ref={this.composer}
              aria-label={localized('Write a message')}
              placeholder={localized('Write a message')}
              rows={2}
              value={composerDraft}
              onChange={(event) => {
                GroupMeChatStore.setComposerDraft(event.target.value);
                this._updateMention(event.target.value, event.target.selectionStart);
              }}
              onClick={(event) =>
                this._updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
              }
              onKeyDown={this._onComposerKeyDown}
            />
          </div>
          <button
            className="matrix-composer-tool"
            type="button"
            aria-label={localized('Mention a person')}
            title={localized('Mention a person')}
            onClick={this._openMentionPicker}
          >
            @
          </button>
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
