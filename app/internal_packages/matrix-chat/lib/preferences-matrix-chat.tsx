import React from 'react';
import { localized, WorkspaceStore, Actions } from 'summermail-exports';
import { Switch } from 'summermail-component-kit';

const providers = [
  { id: 'Matrix', key: 'matrix-chat.enabled', name: 'Matrix' },
  { id: 'GroupMe', key: 'groupme-chat.enabled', name: 'GroupMe' },
] as const;

export default class PreferencesMatrixChat extends React.Component {
  private disposables: Array<{ dispose(): void }> = [];

  componentDidMount() {
    this.disposables = providers.map(({ key }) =>
      AppEnv.config.onDidChange(key, () => this.forceUpdate())
    );
  }

  componentWillUnmount() {
    this.disposables.forEach((item) => item.dispose());
  }

  render() {
    return (
      <div className="container-matrix-chat-preferences">
        <section>
          <h6>{localized('Chat')}</h6>
          <p className="matrix-chat-description">
            {localized(
              'Enable Matrix, GroupMe, or both. Each opens in its own tab, where you can sign in and manage your connection.'
            )}
          </p>
        </section>
        {providers.map(({ id, key, name }) => {
          const enabled = AppEnv.config.get(key) === true;
          return (
            <section key={id}>
              <div className="matrix-chat-toggle-row">
                <Switch
                  checked={enabled}
                  onChange={() => AppEnv.config.set(key, !enabled)}
                  label={localized('Enable %@', name)}
                />
                <span>{name}</span>
              </div>
              {enabled ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const sheet = WorkspaceStore.Sheet[id];
                    if (sheet) Actions.selectRootSheet(sheet);
                  }}
                >
                  {localized('Open %@', name)}
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
    );
  }
}
