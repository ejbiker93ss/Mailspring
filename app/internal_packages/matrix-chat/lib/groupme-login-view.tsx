import React from 'react';
import { localized } from 'summermail-exports';
import GroupMeChatStore from './groupme-store';

interface State {
  error: string | null;
  mfaCode: string;
  password: string;
  showToken: boolean;
  submitting: boolean;
  token: string;
  username: string;
}

export default class GroupMeLoginView extends React.Component<Record<string, never>, State> {
  state: State = {
    error: GroupMeChatStore.error(),
    mfaCode: '',
    password: '',
    showToken: false,
    submitting: false,
    token: '',
    username: '',
  };

  private unlisten?: () => void;
  private mounted = false;

  componentDidMount() {
    this.mounted = true;
    this.unlisten = GroupMeChatStore.listen(this._onStoreChange);
  }

  componentWillUnmount() {
    this.mounted = false;
    this.unlisten?.();
  }

  _onStoreChange = () => {
    if (!this.mounted) return;
    this.setState({ error: GroupMeChatStore.error() });
  };

  _onLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    this.setState({ submitting: true, error: null });
    try {
      if (GroupMeChatStore.mfa()) {
        await GroupMeChatStore.confirmMfa(this.state.mfaCode);
        this.setState({ mfaCode: '', password: '' });
      } else {
        await GroupMeChatStore.login(this.state.username, this.state.password);
        if (!GroupMeChatStore.mfa()) this.setState({ password: '' });
      }
    } catch (error) {
      if (this.mounted)
        this.setState({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (this.mounted) this.setState({ submitting: false });
    }
  };

  _onToken = async (event: React.FormEvent) => {
    event.preventDefault();
    this.setState({ submitting: true, error: null });
    try {
      await GroupMeChatStore.connectWithToken(this.state.token);
      this.setState({ token: '' });
    } catch {
      this.setState({ error: GroupMeChatStore.error() });
    } finally {
      this.setState({ submitting: false });
    }
  };

  _onResend = async () => {
    this.setState({ submitting: true, error: null });
    try {
      await GroupMeChatStore.resendMfaSms();
    } catch (error) {
      if (this.mounted)
        this.setState({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (this.mounted) this.setState({ submitting: false });
    }
  };

  render() {
    const { error, mfaCode, password, showToken, submitting, token, username } = this.state;
    const mfa = GroupMeChatStore.mfa();
    return (
      <div className="matrix-login">
        <form className="matrix-login-card" onSubmit={this._onLogin}>
          <h2>{localized('Sign in to GroupMe')}</h2>
          <p>
            {localized(
              'This is an unofficial GroupMe client. Sign in with your GroupMe email and password. Friends still see your normal GroupMe account.'
            )}
          </p>
          {mfa ? (
            <>
              <label htmlFor="groupme-pin">{localized('SMS PIN')}</label>
              <p className="groupme-verification-help">
                {mfa.smsSent
                  ? localized('GroupMe accepted the text request. Enter the code when it arrives.')
                  : localized(
                      'A text request has not been confirmed. Try sending a new code or start over.'
                    )}
              </p>
              <input
                id="groupme-pin"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={localized('Code from GroupMe')}
                value={mfaCode}
                onChange={(event) => this.setState({ mfaCode: event.target.value })}
              />
              <button
                type="button"
                className="btn matrix-login-secondary"
                disabled={submitting}
                onClick={this._onResend}
              >
                {localized('Send a new code')}
              </button>
              <button
                type="button"
                className="btn"
                disabled={submitting}
                onClick={() => {
                  GroupMeChatStore.cancelMfa();
                  this.setState({ mfaCode: '', password: '' });
                }}
              >
                {localized('Start over')}
              </button>
            </>
          ) : (
            <>
              <label htmlFor="groupme-username">{localized('Email')}</label>
              <input
                id="groupme-username"
                autoComplete="username"
                spellCheck={false}
                placeholder="you@example.com"
                value={username}
                onChange={(event) => this.setState({ username: event.target.value })}
              />
              <label htmlFor="groupme-password">{localized('Password')}</label>
              <input
                id="groupme-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => this.setState({ password: event.target.value })}
              />
            </>
          )}
          {error ? (
            <div className="matrix-login-error" role="alert">
              {error}
            </div>
          ) : null}
          <button
            className="btn btn-emphasis"
            type="submit"
            disabled={submitting || (!!mfa && !mfaCode.trim())}
          >
            {submitting
              ? localized('Signing in…')
              : mfa
                ? localized('Verify PIN')
                : localized('Sign in')}
          </button>
        </form>
        <button
          type="button"
          className="btn matrix-login-secondary"
          onClick={() => this.setState({ showToken: !showToken })}
        >
          {showToken ? localized('Hide access token') : localized('Use a developer access token')}
        </button>
        {showToken ? (
          <form className="matrix-login-card" onSubmit={this._onToken}>
            <p>
              {localized(
                'Paste a token from dev.groupme.com if you already created one. This is optional.'
              )}
            </p>
            <input
              type="password"
              autoComplete="off"
              placeholder={localized('GroupMe access token')}
              value={token}
              onChange={(event) => this.setState({ token: event.target.value })}
            />
            <button className="btn" type="submit" disabled={submitting}>
              {localized('Connect with token')}
            </button>
          </form>
        ) : null}
      </div>
    );
  }
}
