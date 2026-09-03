import MailspringStore from 'mailspring-store';

import {
  Rx,
  Actions,
  Thread,
  QueryResultSet,
  MutableQuerySubscription,
  WorkspaceStore,
  FocusedContentStore,
  FocusedPerspectiveStore,
} from 'mailspring-exports';
import { ListTabular, ListDataSource } from 'mailspring-component-kit';
import ThreadListDataSource from './thread-list-data-source';
import { queryWithThreadListOptions } from './thread-list-query-options';
import UnthreadedState from '../../../src/flux/stores/unthreaded-state';

class ThreadListStore extends MailspringStore {
  _dataSource?: ListDataSource;
  _dataSourceUnlisten: () => void;
  _viewOptions: {
    unthreadedEnabled: boolean;
    sortAscending: boolean;
    unreadOnly: boolean;
  };

  constructor() {
    super();
    this._viewOptions = this._getViewOptions();
    this.listenTo(FocusedPerspectiveStore, this._onPerspectiveChanged);
    this.listenTo(UnthreadedState, this._onViewOptionsChanged);
    this.createListDataSource();
  }

  dataSource = () => {
    return this._dataSource;
  };

  _getViewOptions = () => ({
    unthreadedEnabled: UnthreadedState.enabled(),
    sortAscending: UnthreadedState.sortAscending(),
    unreadOnly: UnthreadedState.unreadOnly(),
  });

  _applyViewOptions = (subscription) => {
    if (!subscription || UnthreadedState.enabled()) {
      return subscription;
    }

    const query = queryWithThreadListOptions(subscription.query(), {
      isSent: FocusedPerspectiveStore.current().isSent(),
      sortAscending: UnthreadedState.sortAscending(),
      unreadOnly: UnthreadedState.unreadOnly(),
    });

    (subscription as MutableQuerySubscription<Thread>).replaceQuery(query);
    return subscription;
  };

  createListDataSource = ({ preserveFocus = false } = {}) => {
    if (typeof this._dataSourceUnlisten === 'function') {
      this._dataSourceUnlisten();
    }

    if (this._dataSource) {
      this._dataSource.cleanup();
      this._dataSource = null;
    }

    const threadsSubscription = this._applyViewOptions(FocusedPerspectiveStore.current().threads());
    if (threadsSubscription) {
      this._dataSource = new ThreadListDataSource(threadsSubscription);
      this._dataSourceUnlisten = this._dataSource.listen(this._onDataChanged, this);
    } else {
      this._dataSource = new ListTabular.DataSource.Empty();
    }

    this.trigger(this);
    if (!preserveFocus) {
      Actions.setFocus({ collection: 'thread', item: null });
    }
  };

  selectionObservable = () => {
    return Rx.Observable.fromListSelection<Thread>(this);
  };

  // Inbound Events

  _onPerspectiveChanged = () => {
    this.createListDataSource();
  };

  _onViewOptionsChanged = () => {
    const next = this._getViewOptions();
    const previous = this._viewOptions;
    if (
      next.unthreadedEnabled === previous.unthreadedEnabled &&
      next.sortAscending === previous.sortAscending &&
      next.unreadOnly === previous.unreadOnly
    ) {
      return;
    }

    this._viewOptions = next;
    if (!next.unthreadedEnabled) {
      this.createListDataSource({
        preserveFocus:
          next.unreadOnly === previous.unreadOnly &&
          next.unthreadedEnabled === previous.unthreadedEnabled,
      });
    }
  };

  _onDataChanged = ({
    previous,
    next,
  }: { previous?: QueryResultSet<Thread>; next?: QueryResultSet<Thread> } = {}) => {
    // This code keeps the focus and keyboard cursor in sync with the thread list.
    // When the thread list changes, it looks to see if the focused thread is gone,
    // or no longer matches the query criteria and advances the focus to the next
    // thread.

    // This means that removing a thread from view in any way causes selection
    // to advance to the adjacent thread. Nice and declarative.
    if (previous && next) {
      const focused = FocusedContentStore.focused('thread');
      const keyboard = FocusedContentStore.keyboardCursor('thread') as Thread | null;
      const viewModeAutofocuses =
        WorkspaceStore.layoutMode() === 'split' || WorkspaceStore.topSheet().root === true;

      const nextQ = next.query();
      const matchers = nextQ && nextQ.matchers();

      const focusedIndex = focused ? previous.offsetOfId(focused.id) : -1;
      const keyboardIndex = keyboard ? previous.offsetOfId(keyboard.id) : -1;

      const nextItemFromIndex = (i: number) => {
        let nextIndex;
        if (
          i > 0 &&
          ((next.modelAtOffset(i - 1) && next.modelAtOffset(i - 1).unread) || i >= next.count())
        ) {
          nextIndex = i - 1;
        } else {
          nextIndex = i;
        }

        // May return null if no thread is loaded at the next index
        return next.modelAtOffset(nextIndex);
      };

      const notInSet = function (model: Thread) {
        if (matchers) {
          return model.matches(matchers) === false;
        } else {
          return next.offsetOfId(model.id) === -1;
        }
      };

      if (viewModeAutofocuses && focused && notInSet(focused)) {
        Actions.setFocus({ collection: 'thread', item: nextItemFromIndex(focusedIndex) });
      }

      if (keyboard && notInSet(keyboard)) {
        Actions.setCursorPosition({
          collection: 'thread',
          item: nextItemFromIndex(keyboardIndex),
        });
      }
    }
  };
}

export default new ThreadListStore();
