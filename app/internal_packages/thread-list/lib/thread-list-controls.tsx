import { React, localized } from 'mailspring-exports';

import UnthreadedState from '../../../src/flux/stores/unthreaded-state';

const ToolbarIcon = ({ name }) => {
  const paths = {
    sort: <path d="M7 4v14m0 0-3-3m3 3 3-3M17 20V6m0 0-3 3m3-3 3 3" />,
    unread: <path d="M3.5 6.5h17v12h-17zM4 7l8 6 8-6" />,
    refresh: <path d="M19 8V4m0 0h-4m4 0-3 3a7 7 0 1 0 2 8" />,
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
};

interface ThreadListControlsState {
  sortAscending: boolean;
  unreadOnly: boolean;
}

export default class ThreadListControls extends React.Component<
  Record<string, never>,
  ThreadListControlsState
> {
  static displayName = 'ThreadListControls';

  _unlisten?: () => void;

  constructor(props) {
    super(props);
    this.state = this._getState();
  }

  componentDidMount() {
    this._unlisten = UnthreadedState.listen(() => this.setState(this._getState()));
  }

  componentWillUnmount() {
    if (this._unlisten) this._unlisten();
  }

  _getState = () => ({
    sortAscending: UnthreadedState.sortAscending(),
    unreadOnly: UnthreadedState.unreadOnly(),
  });

  _refresh = () => {
    AppEnv.commands.dispatch('window:sync-mail-now');
  };

  render() {
    const sortTitle = this.state.sortAscending
      ? localized('Sort by Date (ascending)')
      : localized('Sort by Date (descending)');
    const unreadTitle = this.state.unreadOnly
      ? localized('Show all messages')
      : localized('Show unread only');

    return (
      <div
        className="thread-list-controls"
        role="group"
        aria-label={localized('Message list controls')}
      >
        <button
          className="thread-list-control"
          onClick={UnthreadedState.toggleSort}
          title={sortTitle}
          aria-label={sortTitle}
        >
          <ToolbarIcon name="sort" />
        </button>
        <button
          className={`thread-list-control ${this.state.unreadOnly ? 'active' : ''}`}
          onClick={UnthreadedState.toggleUnreadOnly}
          title={unreadTitle}
          aria-label={unreadTitle}
          aria-pressed={this.state.unreadOnly}
        >
          <ToolbarIcon name="unread" />
        </button>
        <button
          className="thread-list-control"
          onClick={this._refresh}
          title={localized('Refresh')}
          aria-label={localized('Refresh')}
        >
          <ToolbarIcon name="refresh" />
        </button>
      </div>
    );
  }
}
