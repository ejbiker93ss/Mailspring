import React from 'react';
import ReactDOM from 'react-dom';
import {
  localized,
  ISendAction,
  Actions,
  SendActionsStore,
  SoundRegistry,
  Message,
} from 'summermail-exports';
import { Menu, RetinaImg, ButtonDropdown } from 'summermail-component-kit';
import { ALWAYS_CHECK_GRAMMAR_CONFIG_KEY } from './composer-ai-actions';

interface SendActionMenuItem extends ISendAction {
  skipWritingCheck?: boolean;
}

const SEND_WITHOUT_CHECKING_ACTION: SendActionMenuItem = {
  title: 'Send without checking',
  iconUrl: null,
  configKey: 'send-without-checking',
  isAvailableForDraft: () => true,
  performSendAction: () => {},
  skipWritingCheck: true,
};

interface SendActionButtonProps {
  tabIndex: number;
  style: any;
  draft: Message;
  isValidDraft: () => boolean;
  beforeSend?: (anchor?: HTMLElement) => Promise<boolean>;
}

interface SendActionButtonState {
  sendActions: ISendAction[];
  isPreparingSend: boolean;
  autoWritingCheckEnabled: boolean;
}

export class SendActionButton extends React.Component<
  SendActionButtonProps,
  SendActionButtonState
> {
  static displayName = 'SendActionButton';

  static containerRequired = false;

  _unlisteners = [];
  _composedComponent: any;
  _configDisposable: { dispose: () => void } | null = null;

  constructor(props: SendActionButtonProps) {
    super(props);
    this.state = {
      sendActions: SendActionsStore.orderedSendActionsForDraft(props.draft),
      isPreparingSend: false,
      autoWritingCheckEnabled: AppEnv.config.get(ALWAYS_CHECK_GRAMMAR_CONFIG_KEY) === true,
    };
  }

  componentDidMount() {
    this._unlisteners.push(
      SendActionsStore.listen(() => {
        this.setState({
          sendActions: SendActionsStore.orderedSendActionsForDraft(this.props.draft),
        });
      }),
      () => this._configDisposable?.dispose()
    );
    this._configDisposable = AppEnv.config.onDidChange(ALWAYS_CHECK_GRAMMAR_CONFIG_KEY, () => {
      this.setState({
        autoWritingCheckEnabled: AppEnv.config.get(ALWAYS_CHECK_GRAMMAR_CONFIG_KEY) === true,
      });
    });
  }

  componentDidUpdate(prevProps: SendActionButtonProps) {
    if (prevProps.draft !== this.props.draft) {
      this.setState({
        sendActions: SendActionsStore.orderedSendActionsForDraft(this.props.draft),
      });
    }
  }

  componentWillUnmount() {
    for (const unlisten of this._unlisteners) {
      unlisten();
    }
    this._unlisteners = [];
  }

  /* This component is re-rendered constantly because `draft` changes in random ways.
  We only use the draft prop when you click send, so update with more discretion. */
  shouldComponentUpdate(nextProps: SendActionButtonProps, nextState: SendActionButtonState) {
    return (
      nextState.isPreparingSend !== this.state.isPreparingSend ||
      nextState.autoWritingCheckEnabled !== this.state.autoWritingCheckEnabled ||
      nextState.sendActions.map((a) => a.configKey).join(',') !==
        this.state.sendActions.map((a) => a.configKey).join(',')
    );
  }

  primarySend() {
    this._onPrimaryClick();
  }

  _onPrimaryClick = () => {
    this._onSendWithAction(this.state.sendActions[0]);
  };

  _onSendWithAction = async (selectedAction: SendActionMenuItem) => {
    if (this.state.isPreparingSend || !this.props.isValidDraft()) return;

    const sendAction = selectedAction.skipWritingCheck
      ? SendActionsStore.DefaultSendAction
      : selectedAction;

    if (this.props.beforeSend && !selectedAction.skipWritingCheck) {
      this.setState({ isPreparingSend: true });
      let readyToSend = false;
      try {
        const anchor = ReactDOM.findDOMNode(this) as HTMLElement;
        readyToSend = await this.props.beforeSend(anchor);
      } finally {
        this.setState({ isPreparingSend: false });
      }
      if (!readyToSend || !this.props.isValidDraft()) return;
    }

    if (AppEnv.config.get('core.sending.sounds')) {
      SoundRegistry.playSound('hit-send');
    }
    Actions.sendDraft(this.props.draft.headerMessageId, { actionKey: sendAction.configKey });
  };

  _renderSendActionItem = ({ iconUrl }, checking = false) => {
    let plusHTML: React.ReactChild = '';
    let additionalImg: React.ReactChild = null;

    if (iconUrl) {
      plusHTML = <span>&nbsp;+&nbsp;</span>;
      additionalImg = <RetinaImg url={iconUrl} mode={RetinaImg.Mode.ContentIsMask} />;
    }

    return (
      <span>
        <RetinaImg
          name="icon-composer-send.png"
          mode={RetinaImg.Mode.ContentIsMask}
          aria-hidden="true"
        />
        <span className="text">
          {checking ? localized('Checking…') : localized(`Send`)}
          {plusHTML}
        </span>
        {additionalImg}
      </span>
    );
  };

  _renderSendActionMenuItem = ({ title, iconUrl }: ISendAction) => (
    <span className="send-action-menu-item">
      {iconUrl ? <RetinaImg url={iconUrl} mode={RetinaImg.Mode.ContentIsMask} /> : null}
      <span className="text">{localized(title)}</span>
    </span>
  );

  render() {
    const menuActions: SendActionMenuItem[] = [
      ...(this.state.autoWritingCheckEnabled ? [SEND_WITHOUT_CHECKING_ACTION] : []),
      ...this.state.sendActions.slice(1),
    ];

    return (
      <ButtonDropdown
        className={`btn-send btn-emphasis btn-text ${
          this.state.isPreparingSend ? 'is-preparing-send' : ''
        }`}
        style={{ order: -100 }}
        disabled={this.state.isPreparingSend}
        primaryItem={this._renderSendActionItem(
          this.state.sendActions[0],
          this.state.isPreparingSend
        )}
        primaryTitle={
          this.state.isPreparingSend
            ? localized('Checking spelling and grammar…')
            : this.state.sendActions[0].title
        }
        primaryClick={this._onPrimaryClick}
        closeOnMenuClick
        direction="up"
        menu={
          <Menu
            items={menuActions}
            itemKey={(actionConfig) => actionConfig.configKey}
            itemContent={this._renderSendActionMenuItem}
            onSelect={this._onSendWithAction}
          />
        }
      />
    );
  }
}
