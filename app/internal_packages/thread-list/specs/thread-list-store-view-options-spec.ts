import UnthreadedState from '../../../src/flux/stores/unthreaded-state';
import ThreadListStore from '../lib/thread-list-store';

describe('ThreadListStore toolbar options', () => {
  let originalEnabled = false;
  let originalSortAscending = false;
  let originalUnreadOnly = false;

  beforeEach(() => {
    originalEnabled = UnthreadedState.enabled();
    originalSortAscending = UnthreadedState.sortAscending();
    originalUnreadOnly = UnthreadedState.unreadOnly();

    (UnthreadedState as any)._enabled = false;
    (UnthreadedState as any)._sortAscending = false;
    (UnthreadedState as any)._unreadOnly = false;
    (ThreadListStore as any)._viewOptions = (ThreadListStore as any)._getViewOptions();
    spyOn(ThreadListStore, 'createListDataSource');
  });

  afterEach(() => {
    (UnthreadedState as any)._enabled = originalEnabled;
    (UnthreadedState as any)._sortAscending = originalSortAscending;
    (UnthreadedState as any)._unreadOnly = originalUnreadOnly;
    (ThreadListStore as any)._viewOptions = (ThreadListStore as any)._getViewOptions();
  });

  it('rebuilds the standard threaded list while preserving focus for a sort change', () => {
    UnthreadedState.toggleSort();

    expect(ThreadListStore.createListDataSource).toHaveBeenCalledWith({ preserveFocus: true });
  });

  it('rebuilds the standard threaded list and clears focus for an unread filter change', () => {
    UnthreadedState.toggleUnreadOnly();

    expect(ThreadListStore.createListDataSource).toHaveBeenCalledWith({ preserveFocus: false });
  });
});
