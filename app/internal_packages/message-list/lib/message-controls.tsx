/* eslint global-require: 0 */

import React from 'react';
import {
  localized,
  Actions,
  TaskQueue,
  GetMessageRFC2822Task,
  EmlUtils,
  Thread,
  Message,
} from 'summermail-exports';
import { ButtonDropdown, Menu } from 'summermail-component-kit';
import { MailActionIcon, MailActionIconName } from '../../../src/components/mail-action-icon';

interface MessageAction {
  name: string;
  icon: MailActionIconName;
  select: () => void;
}

interface MessageControlsProps {
  thread: Thread;
  message: Message;
}

export default class MessageControls extends React.Component<MessageControlsProps> {
  static displayName = 'MessageControls';

  _items(): MessageAction[] {
    const reply: MessageAction = {
      name: localized('Reply'),
      icon: 'reply',
      select: this._onReply,
    };
    const replyAll: MessageAction = {
      name: localized('Reply All'),
      icon: 'reply-all',
      select: this._onReplyAll,
    };
    const forward: MessageAction = {
      name: localized('Forward'),
      icon: 'forward',
      select: this._onForward,
    };
    const sendAgain: MessageAction = {
      name: localized('Send Again'),
      icon: 'forward',
      select: this._onSendAgain,
    };

    const showOriginal: MessageAction = {
      name: localized('Show Original'),
      icon: 'source',
      select: this._onShowOriginal,
    };

    const secondaryActions = [forward];
    if (this.props.message.folder && this.props.message.folder.role === 'sent') {
      secondaryActions.push(sendAgain);
    }
    secondaryActions.push(showOriginal);

    if (!this.props.message.canReplyAll()) {
      return [reply, ...secondaryActions];
    }
    const defaultReplyType = AppEnv.config.get('core.sending.defaultReplyType');
    return defaultReplyType === 'reply-all'
      ? [replyAll, reply, ...secondaryActions]
      : [reply, replyAll, ...secondaryActions];
  }

  _dropdownMenu(items: MessageAction[]) {
    const itemContent = (item: MessageAction) => (
      <span className="message-action-menu-item">
        <MailActionIcon name={item.icon} />
        <span>{item.name}</span>
      </span>
    );

    return (
      <Menu
        items={items}
        itemKey={(item) => item.name}
        itemContent={itemContent}
        onSelect={(item) => item.select()}
      />
    );
  }

  _onReply = () => {
    const { thread, message } = this.props;
    Actions.composeReply({
      thread,
      message,
      type: 'reply',
      behavior: 'prefer-existing-if-pristine',
    });
  };

  _onReplyAll = () => {
    const { thread, message } = this.props;
    Actions.composeReply({
      thread,
      message,
      type: 'reply-all',
      behavior: 'prefer-existing-if-pristine',
    });
  };

  _onForward = () => {
    const { thread, message } = this.props;
    Actions.composeForward({ thread, message });
  };

  _onSendAgain = () => {
    const { thread, message } = this.props;
    Actions.composeSendAgain({ threadId: thread.id, messageId: message.id });
  };

  _onDownloadEml = () => {
    const { message } = this.props;
    const defaultFilename = EmlUtils.defaultEmlFilename(message.subject);

    AppEnv.showSaveDialog(
      { defaultPath: defaultFilename, title: localized('Save Email') },
      async (savePath: string) => {
        if (!savePath) return;
        const task = new GetMessageRFC2822Task({
          messageId: message.id,
          accountId: message.accountId,
          filepath: savePath,
        });
        Actions.queueTask(task);
        await TaskQueue.waitForPerformRemote(task);
      }
    );
  };

  _onShowActionsMenu = () => {
    const SystemMenu = require('@electron/remote').Menu;
    const SystemMenuItem = require('@electron/remote').MenuItem;

    // Todo: refactor this so that message actions are provided
    // dynamically. Waiting to see if this will be used often.
    const menu = new SystemMenu();
    menu.append(new SystemMenuItem({ label: localized('Log Data'), click: this._onLogData }));
    menu.append(
      new SystemMenuItem({ label: localized('Show Original'), click: this._onShowOriginal })
    );
    menu.append(
      new SystemMenuItem({
        label: localized('Copy Debug Info to Clipboard'),
        click: this._onCopyToClipboard,
      })
    );
    menu.append(new SystemMenuItem({ type: 'separator' }));
    menu.append(
      new SystemMenuItem({ label: localized('Download as .eml'), click: this._onDownloadEml })
    );
    menu.popup({});
  };

  _onShowOriginal = async () => {
    const { message } = this.props;
    const filepath = require('path').join(
      require('@electron/remote').app.getPath('temp'),
      message.id
    );
    const task = new GetMessageRFC2822Task({
      messageId: message.id,
      accountId: message.accountId,
      filepath,
    });
    Actions.queueTask(task);
    await TaskQueue.waitForPerformRemote(task);

    // The task can reach "complete" status even when it failed remotely (eg.
    // the message could not be fetched from the server), in which case the
    // file is never written. Verify it exists before trying to display it.
    if (!require('fs').existsSync(filepath)) {
      AppEnv.showErrorDialog(
        localized('Could not retrieve the original message. Please try again.')
      );
      return;
    }

    const { BrowserWindow } = require('@electron/remote');
    const win = new BrowserWindow({
      width: 800,
      height: 600,
      title: `${message.subject} - RFC822`,
      webPreferences: {
        javascript: false,
        nodeIntegration: false,
      },
    });
    win.loadURL(`file://${filepath}`).catch((err: Error) => {
      console.error('Show Original window failed to load:', err);
    });
  };

  _onLogData = () => {
    console.log(this.props.message);
    (window as any).__message = this.props.message;
    (window as any).__thread = this.props.thread;
    console.log('Also now available in window.__message and window.__thread');
  };

  _onCopyToClipboard = () => {
    const { message, thread } = this.props;
    const data = `
      AccountID: ${message.accountId}
      Message ID: ${message.id}
      Message Metadata: ${JSON.stringify(message.pluginMetadata, null, '  ')}
      Thread ID: ${thread.id}
      Thread Metadata: ${JSON.stringify(thread.pluginMetadata, null, '  ')}
    `;
    require('@electron/remote').clipboard.writeText(data);
  };

  render() {
    const items = this._items();
    return (
      <div className="message-actions-wrap" onClick={(e) => e.stopPropagation()}>
        <ButtonDropdown
          primaryItem={<MailActionIcon name={items[0].icon} />}
          primaryTitle={items[0].name}
          primaryClick={items[0].select}
          closeOnMenuClick
          menu={this._dropdownMenu(items.slice(1))}
        />
        <div
          className="message-actions-ellipsis"
          tabIndex={-1}
          onClick={this._onShowActionsMenu}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              this._onShowActionsMenu();
            }
          }}
        >
          <MailActionIcon name="more" />
        </div>
      </div>
    );
  }
}
