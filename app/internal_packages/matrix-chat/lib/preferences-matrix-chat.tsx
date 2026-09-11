import React from 'react';
import { localized, WorkspaceStore, Actions } from 'summermail-exports';
import { Switch } from 'summermail-component-kit';
import MatrixChatStore from './matrix-chat-store';
import groupMeBridge from './groupme-bridge';

interface State {
  enabled: boolean;
  userId: string | null;
  groupmeConnected: boolean;
  groupmeError: string | null;
  groupmeName: string | null;
  groupmeToken: string;
  chats: Array<{ id: string; name: string; kind: 'group' | 'direct' }>;
}

export default class PreferencesMatrixChat extends React.Component<Record<string, never>, State> {
  state: State = {
    enabled: AppEnv.config.get('matrix-chat.enabled') === true,
    userId: MatrixChatStore.userId(),
    groupmeConnected: groupMeBridge.snapshot().connected,
    groupmeError: groupMeBridge.snapshot().error,
    groupmeName: groupMeBridge.snapshot().userName,
    groupmeToken: '',
    chats: groupMeBridge.snapshot().chats,
  };

  private unlisten?: () => void;

  componentDidMount() {
    this.unlisten = groupMeBridge.listen(this._onBridgeChange);
    void groupMeBridge.restore();
  }

  componentWillUnmount() {
    this.unlisten?.();
  }

  _onBridgeChange = () => {
    const snapshot = groupMeBridge.snapshot();
    this.setState({
      groupmeConnected: snapshot.connected,
      groupmeError: snapshot.error,
      groupmeName: snapshot.userName,
      chats: snapshot.chats,
    });
  };

  _connectGroupMe = async () => {
    try {
      await groupMeBridge.connect(this.state.groupmeToken);
      this.setState({ groupmeToken: '' });
    } catch (error) {
      this.setState({ groupmeError: error instanceof Error ? error.message : String(error) });
    }
  };

  _onToggleEnabled = () => {
    const enabled = !this.state.enabled;
    AppEnv.config.set('matrix-chat.enabled', enabled);
    this.setState({ enabled });
  };

  render() {
    const { enabled, userId } = this.state;
    return (
      <div className="container-matrix-chat-preferences">
        <section>
          <h6>{localized('Matrix Chat')}</h6>
          <p className="matrix-chat-description">
            {localized(
              'Add a Chat tab for Matrix rooms. SummerMail signs in directly, keeps the session on this computer, and continues syncing while you read mail.'
            )}
          </p>
          <div className="matrix-chat-toggle-row">
            <Switch
              checked={enabled}
              onChange={this._onToggleEnabled}
              label={localized('Enable Matrix Chat')}
            />
            <span>{localized('Enable Matrix Chat')}</span>
          </div>
        </section>

        <section>
          <p className="matrix-chat-help">
            {userId
              ? localized('Signed in as %@', userId)
              : localized('Sign in from the Chat tab with a Matrix ID such as @you:example.com.')}
          </p>
          {enabled ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (WorkspaceStore.Sheet.Matrix) {
                  Actions.selectRootSheet(WorkspaceStore.Sheet.Matrix);
                }
              }}
            >
              {localized('Open Chat')}
            </button>
          ) : null}
        </section>

        <section>
          <h6>{localized('GroupMe')}</h6>
          <p className="matrix-chat-description">
            {localized(
              'This is a local Matrix puppet, not a SummerMail-only chat. Pairing creates ordinary rooms on your Matrix account. Any Matrix client can use them. GroupMe still sees your normal account.'
            )}
          </p>
          {this.state.groupmeConnected ? (
            <div>
              <p className="matrix-chat-help">
                {localized('Connected as %@', this.state.groupmeName || 'GroupMe')}
              </p>
              <button type="button" className="btn" onClick={() => void groupMeBridge.disconnect()}>
                {localized('Disconnect GroupMe')}
              </button>
              <ul className="matrix-groupme-chats">
                {this.state.chats.map((chat) => (
                  <li key={chat.id}>
                    <span>
                      {chat.name}
                      <em>{chat.kind === 'direct' ? localized('Direct') : localized('Group')}</em>
                    </span>
                    {groupMeBridge.mappedRoomId(chat.id) ? (
                      <strong>{localized('Paired')}</strong>
                    ) : (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void groupMeBridge.pairChat(chat.id)}
                      >
                        {localized('Pair with Matrix')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="matrix-chat-url-row">
              <input
                type="password"
                value={this.state.groupmeToken}
                placeholder={localized('GroupMe access token')}
                onChange={(event) => this.setState({ groupmeToken: event.target.value })}
              />
              <button type="button" className="btn btn-emphasis" onClick={this._connectGroupMe}>
                {localized('Connect')}
              </button>
            </div>
          )}
          {this.state.groupmeError ? (
            <div className="matrix-login-error">{this.state.groupmeError}</div>
          ) : null}
        </section>
      </div>
    );
  }
}
