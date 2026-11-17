import { React, localized } from 'summermail-exports';

import UnthreadedState from '../../../src/flux/stores/unthreaded-state';

type QuickFilter = 'all' | 'unread' | 'starred';

interface ThreadListFilterChipsState {
  filter: QuickFilter;
}

export default class ThreadListFilterChips extends React.Component<
  Record<string, never>,
  ThreadListFilterChipsState
> {
  static displayName = 'ThreadListFilterChips';
  static containerRequired = false;

  _unlisten?: () => void;

  constructor(props) {
    super(props);
    this.state = this._getState();
  }

  componentDidMount() {
    this._unlisten = UnthreadedState.listen(() => this.setState(this._getState()));
  }

  componentWillUnmount() {
    this._unlisten?.();
  }

  _getState = (): ThreadListFilterChipsState => ({
    filter: UnthreadedState.quickFilter() as QuickFilter,
  });

  render() {
    const filters: { id: QuickFilter; label: string }[] = [
      { id: 'all', label: localized('All') },
      { id: 'unread', label: localized('Unread') },
      { id: 'starred', label: localized('Starred') },
    ];

    return (
      <div
        className="thread-list-filter-chips"
        role="group"
        aria-label={localized('Filter messages')}
      >
        {filters.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`thread-list-filter-chip ${this.state.filter === id ? 'active' : ''}`}
            aria-pressed={this.state.filter === id}
            onClick={() => UnthreadedState.setQuickFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
    );
  }
}
