/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- Ported legacy plugin module; compiled by the first-party TypeScript pipeline.
import {
  React,
  AccountStore,
  PropTypes,
  Actions,
  TaskQueue,
  CategoryStore,
  ChangeFolderTask,
} from 'mailspring-exports';
import { RetinaImg } from 'mailspring-component-kit';

export default class MessageOwnerStatus extends React.Component {
  static displayName = 'MessageOwnerStatus';

  static propTypes = {
    message: PropTypes.object.isRequired,
  };

  static containerStyles = {
    display: 'inline-flex',
    alignItems: 'center',
    marginRight: 10,
    order: -1,
  };

  state = {
    deleting: false,
  };

  componentDidMount() {
    this._applyOwnershipClasses();
    this._startReplyAreaObserver();
  }

  componentDidUpdate() {
    this._applyOwnershipClasses();
  }

  componentWillUnmount() {
    this._stopReplyAreaObserver();
    const wrap = this._messageWrap();
    if (wrap) {
      wrap.classList.remove('sent-by-me');
      wrap.classList.remove('received-from-others');
    }
    this._syncReplyAreaClasses();
  }

  _messageWrap() {
    return this._anchor ? this._anchor.closest('.message-item-wrap') : null;
  }

  _isSentByMe() {
    const { message } = this.props;
    const from = message && message.from && message.from[0];
    if (!from || !from.email) {
      return false;
    }

    const account = AccountStore.accountForEmail(from.email);
    return !!account && account.id === message.accountId;
  }

  _applyOwnershipClasses() {
    const wrap = this._messageWrap();
    if (!wrap) {
      return;
    }

    const sentByMe = this._isSentByMe();
    wrap.classList.toggle('sent-by-me', sentByMe);
    wrap.classList.toggle('received-from-others', !sentByMe);

    this._syncReplyAreaClasses();
  }

  _startReplyAreaObserver() {
    if (this._replyAreaObserver || !window.MutationObserver) {
      return;
    }

    const messageList = document.querySelector('#message-list');
    if (!messageList) {
      return;
    }

    this._replyAreaObserver = new MutationObserver(() => {
      this._syncReplyAreaClasses();
    });
    this._replyAreaObserver.observe(messageList, {
      childList: true,
      subtree: true,
    });
  }

  _stopReplyAreaObserver() {
    if (this._replyAreaObserver) {
      this._replyAreaObserver.disconnect();
      this._replyAreaObserver = null;
    }
  }

  _syncReplyAreaClasses() {
    const messageList = document.querySelector('#message-list');
    if (!messageList) {
      return;
    }

    this._syncReplyAreaTarget(messageList.querySelector('.footer-reply-area-wrap'), true, false);

    Array.from(messageList.querySelectorAll('.composer-outer-wrap')).forEach((composerWrap) => {
      this._syncReplyAreaTarget(composerWrap, true, false);
      this._syncReplyAreaTarget(composerWrap.closest('.message-item-wrap'), true, false);
    });
  }

  _syncReplyAreaTarget(target, sentByMe, receivedFromOthers) {
    if (!target) {
      return;
    }

    const hasSentByMe = target.classList.contains('sent-by-me');
    const hasReceivedFromOthers = target.classList.contains('received-from-others');
    if (hasSentByMe !== sentByMe) {
      target.classList.toggle('sent-by-me', sentByMe);
    }
    if (hasReceivedFromOthers !== receivedFromOthers) {
      target.classList.toggle('received-from-others', receivedFromOthers);
    }
  }

  _inTrashFolder() {
    const { message } = this.props;
    const trash = CategoryStore.getTrashCategory(message.accountId);
    if (!trash) {
      return false;
    }

    return !!message.folder && message.folder.id === trash.id;
  }

  _trashSingleMessage = async () => {
    const { message } = this.props;
    const trash = CategoryStore.getTrashCategory(message.accountId);
    if (!trash || this._inTrashFolder() || this.state.deleting) {
      return;
    }

    this.setState({ deleting: true });

    try {
      const task = new ChangeFolderTask({
        folder: trash,
        messages: [message],
        source: 'Plugin Starter: Message Trash Button',
      });

      // Workaround for hosts that serialize empty threadIds before messageIds.
      // Keep arrays intact for willBeQueued() checks, but remove empty arrays from
      // the serialized payload sent to mailsync.
      const baseToJSON = task.toJSON.bind(task);
      task.toJSON = () => {
        const json = baseToJSON();
        if (Array.isArray(json.threadIds) && json.threadIds.length === 0) {
          delete json.threadIds;
        }
        if (Array.isArray(json.messageIds) && json.messageIds.length === 0) {
          delete json.messageIds;
        }
        return json;
      };

      Actions.queueTask(task);
      await TaskQueue.waitForPerformLocal(task);
      if (AppEnv && AppEnv.mailsyncBridge && AppEnv.mailsyncBridge.sendSyncMailNow) {
        AppEnv.mailsyncBridge.sendSyncMailNow();
      }
    } finally {
      this.setState({ deleting: false });
    }
  };

  render() {
    const inTrash = this._inTrashFolder();
    const { deleting } = this.state;

    return (
      <span className="message-owner-status-wrap">
        <span
          className="message-owner-status"
          ref={(el) => {
            this._anchor = el;
          }}
        />
        <button
          className="btn btn-toolbar message-trash-single-btn"
          disabled={inTrash || deleting}
          onClick={this._trashSingleMessage}
          onMouseDown={(event) => event.stopPropagation()}
          title={inTrash ? 'Message is already in Trash' : 'Move this message to Trash'}
          type="button"
        >
          <RetinaImg name="toolbar-trash.png" mode={RetinaImg.Mode.ContentIsMask} />
        </button>
      </span>
    );
  }
}
