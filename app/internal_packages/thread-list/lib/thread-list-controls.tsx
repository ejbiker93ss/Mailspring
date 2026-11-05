import { React, localized, FocusedPerspectiveStore } from 'summermail-exports';
import { MailSortField } from '../../../src/services/mail-sort';

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
  sortField: MailSortField;
  isSearch: boolean;
  sortAscending: boolean;
  unreadOnly: boolean;
}

export default class ThreadListControls extends React.Component<
  Record<string, never>,
  ThreadListControlsState
> {
  static displayName = 'ThreadListControls';

  _unlisten?: () => void;
  _unlistenPerspective?: () => void;

  constructor(props) {
    super(props);
    this.state = this._getState();
  }

  componentDidMount() {
    this._unlisten = UnthreadedState.listen(() => this.setState(this._getState()));
    this._unlistenPerspective = FocusedPerspectiveStore.listen(() =>
      this.setState(this._getState())
    );
  }

  componentWillUnmount() {
    if (this._unlisten) this._unlisten();
    this._unlistenPerspective?.();
  }

  _getState = () => ({
    sortField: UnthreadedState.sortField() as MailSortField,
    isSearch: !!(FocusedPerspectiveStore.current() as any)?.searchQuery,
    sortAscending: UnthreadedState.sortAscending(),
    unreadOnly: UnthreadedState.unreadOnly(),
  });

  _refresh = () => {
    AppEnv.commands.dispatch('window:sync-mail-now');
  };

  _sortField = (): MailSortField =>
    this.state.sortField === 'relevance' && !this.state.isSearch ? 'date' : this.state.sortField;

  _sortLabels = () => ({
    relevance: localized('Relevance'),
    date: localized('Date'),
    size: localized('Size'),
    from: localized('Sender'),
    subject: localized('Subject'),
  });

  _openSortMenu = () => {
    const { Menu } = require('@electron/remote');
    const field = this._sortField();
    const labels = this._sortLabels();
    const fields: MailSortField[] = this.state.isSearch
      ? ['relevance', 'date', 'size', 'from', 'subject']
      : ['date', 'size', 'from', 'subject'];
    const directionLabels =
      field === 'size'
        ? [localized('Smallest first'), localized('Largest first')]
        : field === 'from' || field === 'subject'
          ? [localized('A to Z'), localized('Z to A')]
          : [localized('Oldest first'), localized('Newest first')];
    Menu.buildFromTemplate([
      ...fields.map((value) => ({
        label: labels[value],
        type: 'radio',
        checked: field === value,
        click: () => UnthreadedState.setSortField(value),
      })),
      { type: 'separator' },
      ...[true, false].map((ascending, index) => ({
        label: directionLabels[index],
        type: 'radio',
        enabled: field !== 'relevance',
        checked: field !== 'relevance' && this.state.sortAscending === ascending,
        click: () => {
          if (UnthreadedState.sortAscending() !== ascending) UnthreadedState.toggleSort();
          else if (UnthreadedState.sortField() === 'relevance')
            UnthreadedState.setSortField('date');
        },
      })),
    ]).popup({});
  };

  render() {
    const field = this._sortField();
    const sortTitle = localized('Sort by %@', this._sortLabels()[field]);
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
          type="button"
          className="thread-list-control"
          onClick={this._openSortMenu}
          title={sortTitle}
          aria-label={sortTitle}
          aria-haspopup="menu"
        >
          <ToolbarIcon name="sort" />
        </button>
        <button
          type="button"
          className={`thread-list-control ${this.state.unreadOnly ? 'active' : ''}`}
          onClick={UnthreadedState.toggleUnreadOnly}
          title={unreadTitle}
          aria-label={unreadTitle}
          aria-pressed={this.state.unreadOnly}
        >
          <ToolbarIcon name="unread" />
        </button>
        <button
          type="button"
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
