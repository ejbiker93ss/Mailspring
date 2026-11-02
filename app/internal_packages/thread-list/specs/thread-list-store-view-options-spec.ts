import { Actions, FocusedContentStore, Thread, WorkspaceStore } from 'summermail-exports';
import UnthreadedState from '../../../src/flux/stores/unthreaded-state';
import RecentlyReadStore from '../../../src/flux/stores/recently-read-store';
import ThreadListStore from '../lib/thread-list-store';

describe('ThreadListStore toolbar options', () => {
  let originalEnabled = false;
  let originalSortAscending = false;
  let originalUnreadOnly = false;
  let originalSortField = 'relevance';

  beforeEach(() => {
    originalEnabled = UnthreadedState.enabled();
    originalSortAscending = UnthreadedState.sortAscending();
    originalUnreadOnly = UnthreadedState.unreadOnly();
    originalSortField = UnthreadedState.sortField();

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
    (UnthreadedState as any)._sortField = originalSortField;
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

  it('keeps deferred-query subscriptions connected while their query is being prepared', () => {
    const subscription = {
      query: jasmine.createSpy('query').andReturn(null),
      replaceQuery: jasmine.createSpy('replaceQuery'),
    };

    const result = (ThreadListStore as any)._applyViewOptions(subscription);

    expect(result).toBe(subscription);
    expect(subscription.replaceQuery).not.toHaveBeenCalled();
  });
});

describe('ThreadListStore focus when a thread leaves an unread-only list', () => {
  const resultSet = (threads: Thread[]) => ({
    offsetOfId: (id: string) => threads.findIndex((t) => t.id === id),
    modelAtOffset: (i: number) => threads[i],
    count: () => threads.length,
    query: () => ({ matchers: () => [Thread.attributes.unread.equal(true)] }),
  });
  const opened = new Thread({ id: 'opened', unread: false });
  const next = new Thread({ id: 'next', unread: true });
  let originalIds = [];

  beforeEach(() => {
    originalIds = RecentlyReadStore.ids;
    spyOn(WorkspaceStore, 'layoutMode').andReturn('split');
    spyOn(FocusedContentStore, 'focused').andReturn(opened);
    spyOn(FocusedContentStore, 'keyboardCursor').andReturn(null);
    spyOn(Actions, 'setFocus');
  });

  afterEach(() => {
    RecentlyReadStore.ids = originalIds;
  });

  const removeOpenedThread = () =>
    (ThreadListStore as any)._onDataChanged({
      previous: resultSet([new Thread({ id: 'opened', unread: true }), next]),
      next: resultSet([next]),
    });

  it('keeps focus on a thread that left the list because it was just read', () => {
    RecentlyReadStore.ids = ['opened'];
    removeOpenedThread();
    expect(Actions.setFocus).not.toHaveBeenCalled();
  });

  it('still advances focus when a thread leaves the list for another reason', () => {
    RecentlyReadStore.ids = [];
    removeOpenedThread();
    expect(Actions.setFocus).toHaveBeenCalledWith({ collection: 'thread', item: next });
  });
});
