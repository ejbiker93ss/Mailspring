import classNames from 'classnames';
import React from 'react';
import {
  Utils,
  DraftStore,
  ComponentRegistry,
  AccountStore,
  Thread,
  Message,
} from 'mailspring-exports';

import MessageItem from './message-item';

interface MessageItemContainerProps {
  thread: Thread;
  message: Message;
  messages: Message[];
  collapsed: boolean;
  isMostRecent: boolean;
  isBeforeReplyArea: boolean;
  scrollTo: () => void;
}

interface MessageItemContainerState {
  sendState: ReturnType<typeof DraftStore.sendStateForDraft>;
}

export default class MessageItemContainer extends React.Component<
  MessageItemContainerProps,
  MessageItemContainerState
> {
  static displayName = 'MessageItemContainer';

  _unlisten: () => void;
  _messageComponent: MessageItem | React.ComponentType<any>;

  constructor(props: MessageItemContainerProps, context: object) {
    super(props, context);
    this.state = this._getStateFromStores();
  }

  componentDidMount() {
    if (this.props.message.draft) {
      this._unlisten = DraftStore.listen(this._onSendingStateChanged);
    }
  }

  componentDidUpdate(prevProps: MessageItemContainerProps) {
    if (prevProps.message !== this.props.message || prevProps.thread !== this.props.thread) {
      this.setState(this._getStateFromStores(this.props));
    }
  }

  shouldComponentUpdate(
    nextProps: MessageItemContainerProps,
    nextState: MessageItemContainerState
  ) {
    return !Utils.isEqualReact(nextProps, this.props) || !Utils.isEqualReact(nextState, this.state);
  }

  componentWillUnmount() {
    if (this._unlisten) {
      this._unlisten();
    }
  }

  focus = () => {
    this._messageComponent['focus'] && this._messageComponent['focus']();
  };

  _classNames() {
    const { message } = this.props;
    const from = message.from && message.from[0];
    const senderAccount = from && from.email ? AccountStore.accountForEmail(from.email) : null;
    const sentByMe = message.draft || !!(senderAccount && senderAccount.id === message.accountId);

    return classNames({
      draft: message.draft,
      unread: message.unread,
      collapsed: this.props.collapsed,
      'message-item-wrap': true,
      'before-reply-area': this.props.isBeforeReplyArea,
      'sent-by-me': sentByMe,
      'received-from-others': !sentByMe,
    });
  }

  _onSendingStateChanged = ({ headerMessageId }) => {
    if (headerMessageId === this.props.message.headerMessageId) {
      this.setState(this._getStateFromStores());
    }
  };

  _getStateFromStores(props = this.props) {
    return {
      sendState: DraftStore.sendStateForDraft(props.message.headerMessageId),
    };
  }

  _renderMessage({
    pending,
    sendState = null,
  }: {
    pending: boolean;
    sendState?: ReturnType<typeof DraftStore.sendStateForDraft>;
  }) {
    return (
      <MessageItem
        ref={(cm) => {
          this._messageComponent = cm;
        }}
        pending={pending}
        sendState={sendState}
        thread={this.props.thread}
        message={this.props.message}
        messages={this.props.messages}
        className={this._classNames()}
        collapsed={this.props.collapsed}
        isMostRecent={this.props.isMostRecent}
      />
    );
  }

  _renderComposer() {
    const Composer = ComponentRegistry.findComponentsMatching({ role: 'Composer' })[0];
    if (!Composer) {
      return <span>No Composer Component Present</span>;
    }
    return (
      <Composer
        ref={(cm) => {
          this._messageComponent = cm;
        }}
        headerMessageId={this.props.message.headerMessageId}
        className={this._classNames()}
        mode={'inline'}
        threadId={this.props.thread.id}
        scrollTo={this.props.scrollTo}
      />
    );
  }

  render() {
    if (this.state.sendState) {
      return this._renderMessage({ pending: true, sendState: this.state.sendState });
    }
    if (this.props.message.draft && !this.props.collapsed) {
      return this._renderComposer();
    }
    return this._renderMessage({ pending: false });
  }
}
