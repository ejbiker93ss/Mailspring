import React from 'react';
import { localized } from 'summermail-exports';
import MatrixChatStore from './matrix-chat-store';

interface State {
  error: string | null;
  homeserver: string;
  login: string;
  password: string;
  submitting: boolean;
}

export default class MatrixLoginView extends React.Component<Record<string, never>, State> {
  state: State = {
    error: MatrixChatStore.error(),
    homeserver: '',
    login: '',
    password: '',
    submitting: false,
  };

  componentDidMount() {
    this.unlisten = MatrixChatStore.listen(this._onStoreChange);
  }

  componentWillUnmount() {
    this.unlisten?.();
  }

  private unlisten?: () => void;

  _onStoreChange = () => {
    this.setState({ error: MatrixChatStore.error() });
  };

  _onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    this.setState({ submitting: true, error: null });
    try {
      await MatrixChatStore.login(this.state.login, this.state.password, this.state.homeserver);
    } catch {
      this.setState({ error: MatrixChatStore.error() });
    } finally {
      this.setState({ submitting: false });
    }
  };

  render() {
    const { error, homeserver, login, password, submitting } = this.state;
    return (
      <div className="matrix-login">
        <form className="matrix-login-card" onSubmit={this._onSubmit}>
          <h2>{localized('Sign in to Chat')}</h2>
          <p>
            {localized(
              'Enter your username, homeserver, and password. You can also paste a full Matrix ID such as @you:example.com.'
            )}
          </p>
          <label htmlFor="matrix-login-id">{localized('Username')}</label>
          <input
            id="matrix-login-id"
            autoComplete="username"
            spellCheck={false}
            placeholder="you"
            value={login}
            onChange={(event) => this.setState({ login: event.target.value })}
          />
          <label htmlFor="matrix-login-homeserver">{localized('Homeserver')}</label>
          <input
            id="matrix-login-homeserver"
            autoComplete="url"
            spellCheck={false}
            placeholder="matrix.example.com"
            value={homeserver}
            onChange={(event) => this.setState({ homeserver: event.target.value })}
          />
          <label htmlFor="matrix-login-password">{localized('Password')}</label>
          <input
            id="matrix-login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => this.setState({ password: event.target.value })}
          />
          {error ? (
            <div className="matrix-login-error" role="alert">
              {error}
            </div>
          ) : null}
          <button className="btn btn-emphasis" type="submit" disabled={submitting}>
            {submitting ? localized('Signing in…') : localized('Sign in')}
          </button>
        </form>
      </div>
    );
  }
}
