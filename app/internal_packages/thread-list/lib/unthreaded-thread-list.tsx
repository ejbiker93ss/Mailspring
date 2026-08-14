/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- Ported legacy plugin module; compiled by the first-party TypeScript pipeline.
import {
  React,
  Rx,
  Utils,
  Actions,
  DatabaseStore,
  FocusedPerspectiveStore,
  CategoryStore,
  TaskFactory,
  localized,
} from 'mailspring-exports';
import { Spinner, ScrollRegion } from 'mailspring-component-kit';
import MailspringStore from 'mailspring-store';

import UnthreadedState from '../../../src/flux/stores/unthreaded-state';

const { Message } = require('mailspring-exports');

const RowActionIcon = ({ name }) => {
  const paths = {
    reply: <path d="M9 7 4 12l5 5v-3c5 0 8 1 11 4-1-6-4-9-11-9V7Z" />,
    flag: <path d="M6 21V4m0 1h11l-2 4 2 4H6" />,
    trash: <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />,
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
};

class VisibleMessagesStore extends MailspringStore {
  constructor() {
    super();
    this._items = [];
    this._loading = true;
    this._subscription = null;
    this._requestId = 0;
    this.listenTo(FocusedPerspectiveStore, this._reload);
    this.listenTo(DatabaseStore, this._onDatabaseChanged);
    this.listenTo(UnthreadedState, this._reload);
    this._reload();
  }

  items() {
    return this._items;
  }

  loading() {
    return this._loading;
  }

  _disposeSubscription() {
    if (this._subscription) {
      this._subscription.dispose();
      this._subscription = null;
    }
  }

  _onDatabaseChanged = (change) => {
    if (!UnthreadedState.enabled()) {
      return;
    }
    if (!change || !['Message', 'Thread'].includes(change.objectClass)) {
      return;
    }
    this._reload();
  };

  _shouldIncludeMessage(message) {
    if (!message || message.isHidden()) {
      return false;
    }

    const viewingTrash = FocusedPerspectiveStore.current().categoriesSharedRole() === 'trash';
    if (viewingTrash) {
      return true;
    }

    if (UnthreadedState.enabled() && UnthreadedState.isGrouped()) {
      return true;
    }

    const trash = CategoryStore.getTrashCategory(message.accountId);
    if (!trash) {
      return true;
    }

    return !message.folder || message.folder.id !== trash.id;
  }

  _reload = () => {
    this._disposeSubscription();
    this._requestId += 1;
    const requestId = this._requestId;

    // This store exists for the lifetime of the package, including while the
    // regular threaded list is active. Do not run a second, hidden 200-thread
    // query (and then load every message in those threads) unless the
    // unthreaded view is actually enabled. Busy folders such as Unread can
    // otherwise block the renderer even though the duplicate list is invisible.
    if (!UnthreadedState.enabled()) {
      this._items = [];
      this._loading = false;
      this.trigger();
      return;
    }

    const threadSubscription = FocusedPerspectiveStore.current().threads();
    if (!threadSubscription) {
      this._items = [];
      this._loading = false;
      UnthreadedState.ensureValidSelection([]);
      this.trigger();
      return;
    }

    this._loading = true;
    this.trigger();

    threadSubscription.replaceRange({ start: 0, end: 200 });

    this._subscription = Rx.Observable.fromNamedQuerySubscription(
      'unthreaded-visible-threads',
      threadSubscription
    ).subscribe(async (resultSet) => {
      if (requestId !== this._requestId) {
        return;
      }
      const threads = resultSet.models ? resultSet.models() : [];
      const ids = threads.map((thread) => thread.id);
      if (ids.length === 0) {
        this._items = [];
        this._loading = false;
        UnthreadedState.ensureValidSelection([]);
        this.trigger();
        return;
      }

      const threadMap = {};
      threads.forEach((thread) => {
        threadMap[thread.id] = thread;
      });

      const messages = (await DatabaseStore.findAll(Message, { threadId: ids }))
        .filter((message) => this._shouldIncludeMessage(message))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .map((message) => ({
          id: message.id,
          message,
          thread: threadMap[message.threadId],
        }))
        .filter((item) => !!item.thread);

      if (requestId !== this._requestId) {
        return;
      }

      this._items = messages;
      this._loading = false;
      UnthreadedState.ensureValidSelection(messages);
      this.trigger();
    });
  };
}

const visibleMessagesStore = new VisibleMessagesStore();

export default class UnthreadedThreadList extends React.Component {
  static displayName = 'UnthreadedThreadList';

  static CoreComponent = null;

  static containerStyles = {
    minWidth: 220,
    maxWidth: 3000,
  };

  constructor(props) {
    super(props);
    this.state = this._getState();
    this.state.collapsedSections = {};
  }

  componentDidMount() {
    this._unsubscribers = [
      visibleMessagesStore.listen(this._onChange),
      UnthreadedState.listen(this._onChange),
    ];
  }

  componentWillUnmount() {
    (this._unsubscribers || []).forEach((unsub) => unsub());
  }

  shouldComponentUpdate(nextProps, nextState) {
    return !Utils.isEqualReact(nextProps, this.props) || !Utils.isEqualReact(nextState, this.state);
  }

  _getState = () => ({
    enabled: UnthreadedState.enabled(),
    layout: UnthreadedState.layout(),
    items: visibleMessagesStore.items(),
    loading: visibleMessagesStore.loading(),
    selected: UnthreadedState.selected(),
    expandedThreads: this.state && this.state.expandedThreads ? this.state.expandedThreads : {},
    collapsedSections:
      this.state && this.state.collapsedSections ? this.state.collapsedSections : {},
  });

  _onChange = () => {
    this.setState(this._getState());
  };

  _onSelect = (item, { expandThread = true } = {}) => {
    UnthreadedState.setSelected(item);
    if (item && item.thread) {
      if (expandThread && UnthreadedState.isGrouped()) {
        this.setState((prevState) => ({
          expandedThreads: {
            ...prevState.expandedThreads,
            [item.thread.id]: true,
          },
        }));
      }
      Actions.setFocus({ collection: 'thread', item: item.thread });
    }
  };

  _onToggleThread = (threadId) => {
    this.setState((prevState) => ({
      expandedThreads: {
        ...prevState.expandedThreads,
        [threadId]: !prevState.expandedThreads[threadId],
      },
    }));
  };

  _onGroupHeaderClick = (group) => {
    const leadItem = group && group.items && group.items[0];
    if (!leadItem) {
      return;
    }

    this._onSelect(leadItem, { expandThread: false });

    if (group.items.length > 1) {
      this._onToggleThread(group.id);
    }
  };

  _renderCore() {
    const Core = UnthreadedThreadList.CoreComponent;
    return Core ? <Core {...this.props} /> : <div />;
  }

  _visibleItems() {
    const items = UnthreadedState.unreadOnly()
      ? this.state.items.filter((item) => item.message.unread)
      : this.state.items.slice();
    const direction = UnthreadedState.sortAscending() ? 1 : -1;
    return items.sort(
      (a, b) =>
        direction * (new Date(a.message.date).getTime() - new Date(b.message.date).getTime())
    );
  }

  _groupedItems(items = this._visibleItems()) {
    const groups = [];
    const groupsByThreadId = {};

    items.forEach((item) => {
      const threadId = item.thread && item.thread.id;
      if (!threadId) {
        return;
      }

      if (!groupsByThreadId[threadId]) {
        groupsByThreadId[threadId] = {
          id: threadId,
          thread: item.thread,
          items: [],
          latestDate: item.message.date,
        };
        groups.push(groupsByThreadId[threadId]);
      }

      groupsByThreadId[threadId].items.push(item);
      if (
        new Date(item.message.date).getTime() >
        new Date(groupsByThreadId[threadId].latestDate).getTime()
      ) {
        groupsByThreadId[threadId].latestDate = item.message.date;
      }
    });

    groups.forEach((group) => {
      group.items.sort(
        (a, b) => new Date(a.message.date).getTime() - new Date(b.message.date).getTime()
      );
    });

    const direction = UnthreadedState.sortAscending() ? 1 : -1;
    groups.sort(
      (a, b) => direction * (new Date(a.latestDate).getTime() - new Date(b.latestDate).getTime())
    );

    return groups;
  }

  _renderUngroupedList() {
    const items = this._visibleItems();
    return items.map((item, index) =>
      this._renderItem(item, {
        isLast: index === items.length - 1,
      })
    );
  }

  _sectionForDate(value) {
    const date = new Date(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(today.getDate() - 7);
    const lastMonth = new Date(today);
    lastMonth.setDate(today.getDate() - 30);

    if (date >= today) return 'today';
    if (date >= yesterday) return 'yesterday';
    if (date >= lastWeek) return 'last-week';
    if (date >= lastMonth) return 'last-month';
    return 'older';
  }

  _dateSections(entries, dateForEntry) {
    const labels = {
      today: localized('Today'),
      yesterday: localized('Yesterday'),
      'last-week': localized('Last Week'),
      'last-month': localized('Last Month'),
      older: localized('Older'),
    };
    const order = ['today', 'yesterday', 'last-week', 'last-month', 'older'];
    const buckets = {};
    entries.forEach((entry) => {
      const key = this._sectionForDate(dateForEntry(entry));
      (buckets[key] || (buckets[key] = [])).push(entry);
    });
    const keys = UnthreadedState.sortAscending() ? order.slice().reverse() : order;
    return keys
      .filter((key) => buckets[key] && buckets[key].length)
      .map((key) => ({ key, label: labels[key], entries: buckets[key] }));
  }

  _toggleSection = (key) => {
    this.setState((prevState) => ({
      collapsedSections: {
        ...prevState.collapsedSections,
        [key]: !prevState.collapsedSections[key],
      },
    }));
  };

  _renderDateSections(sections, renderEntry) {
    return sections.map((section) => {
      const collapsed = !!this.state.collapsedSections[section.key];
      return (
        <section className="unthreaded-date-section" key={section.key}>
          <button
            className="unthreaded-date-section-header"
            onClick={() => this._toggleSection(section.key)}
            aria-expanded={!collapsed}
          >
            <span className={`unthreaded-date-section-caret ${collapsed ? '' : 'expanded'}`} />
            <span className="unthreaded-date-section-label">{section.label}</span>
            <span className="unthreaded-date-section-count">{section.entries.length}</span>
          </button>
          {!collapsed ? (
            <div className="unthreaded-date-section-items">
              {section.entries.map((entry, index) => renderEntry(entry, index, section.entries))}
            </div>
          ) : null}
        </section>
      );
    });
  }

  _isInTrash(item) {
    if (!item || !item.message) {
      return false;
    }

    const trash = CategoryStore.getTrashCategory(item.message.accountId);
    if (!trash) {
      return false;
    }

    return !!item.message.folder && item.message.folder.id === trash.id;
  }

  _renderItem(item, { nested = false, isLast = false, onClick = null } = {}) {
    const selectedId =
      this.state.selected && this.state.selected.message && this.state.selected.message.id;
    const selected = selectedId === item.message.id;
    const inTrash = this._isInTrash(item);
    const from = item.message.from && item.message.from[0];
    const fromName = from ? from.displayName({ compact: true }) : '';
    const subject = item.message.subject || '(No Subject)';
    const date = item.message.date ? new Date(item.message.date).toLocaleString() : '';
    const canTrash =
      !inTrash && FocusedPerspectiveStore.current().canMoveThreadsTo([item.thread], 'trash');

    const stopAnd = (callback) => (event) => {
      event.preventDefault();
      event.stopPropagation();
      callback();
    };

    const reply = () =>
      Actions.composeReply({
        threadId: item.thread.id,
        messageId: item.message.id,
        popout: true,
        type: 'reply',
        behavior: 'prefer-existing-if-pristine',
      });
    const toggleFlag = () =>
      Actions.queueTask(
        TaskFactory.taskForInvertingStarred({
          source: 'Message Card Hover Action',
          threads: [item.thread],
        })
      );
    const moveToTrash = () =>
      Actions.queueTasks(
        TaskFactory.tasksForMovingToTrash({
          source: 'Message Card Hover Action',
          threads: [item.thread],
        })
      );

    return (
      <div
        key={item.message.id}
        className={`unthreaded-row ${nested ? 'nested' : ''} ${isLast ? 'last' : ''} ${selected ? 'selected' : ''} ${item.message.unread ? 'unread' : ''} ${inTrash ? 'in-trash' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          if (onClick) {
            onClick(item);
            return;
          }
          this._onSelect(item);
        }}
      >
        <div className="unthreaded-row-top">
          <div className={`unthreaded-from ${inTrash ? 'trashed' : ''}`}>{fromName}</div>
          <div className={`unthreaded-row-meta ${inTrash ? 'trashed' : ''}`}>
            <div className="unthreaded-date">{date}</div>
          </div>
        </div>
        <div className={`unthreaded-subject ${inTrash ? 'trashed' : ''}`}>{subject}</div>
        <div className="unthreaded-snippet">{item.message.snippet || ''}</div>
        <div
          className="unthreaded-row-actions"
          role="group"
          aria-label={localized('Message actions')}
        >
          <button
            className={item.thread.starred ? 'active' : ''}
            title={item.thread.starred ? localized('Unflag') : localized('Flag')}
            aria-label={item.thread.starred ? localized('Unflag') : localized('Flag')}
            aria-pressed={!!item.thread.starred}
            onClick={stopAnd(toggleFlag)}
          >
            <RowActionIcon name="flag" />
          </button>
          {canTrash ? (
            <button
              title={localized('Trash')}
              aria-label={localized('Trash')}
              onClick={stopAnd(moveToTrash)}
            >
              <RowActionIcon name="trash" />
            </button>
          ) : null}
          <button
            className="unthreaded-row-action-reply"
            title={localized('Reply')}
            aria-label={localized('Reply')}
            onClick={stopAnd(reply)}
          >
            <RowActionIcon name="reply" />
          </button>
        </div>
      </div>
    );
  }

  _renderGroup(group) {
    const selectedId =
      this.state.selected && this.state.selected.message && this.state.selected.message.id;
    const expandable = group.items.length > 1;
    const expanded = group.items.length <= 1 || !!this.state.expandedThreads[group.id];
    const visibleItems = expanded ? group.items : [group.items[0]];

    return (
      <div key={group.id} className={`unthreaded-group ${expanded ? 'expanded' : ''}`}>
        <div
          className={`unthreaded-group-header ${expandable ? 'clickable' : 'single'}`}
          onClick={() => this._onGroupHeaderClick(group)}
        >
          {expandable ? (
            <div className={`unthreaded-group-caret ${expanded ? 'expanded' : 'collapsed'}`} />
          ) : null}
          <div className="unthreaded-group-body">
            {this._renderItem(group.items[0], {
              isLast: expanded && visibleItems.length === 1,
              onClick: () => this._onGroupHeaderClick(group),
            })}
          </div>
        </div>
        {visibleItems.slice(1).map((item, index) => {
          const nested = true;
          const isLast = index === visibleItems.slice(1).length - 1;
          const row = this._renderItem(item, { nested, isLast });

          return (
            <div
              key={item.message.id}
              className={`unthreaded-tree-row ${selectedId === item.message.id ? 'selected' : ''}`}
            >
              <div className={`unthreaded-tree-rail ${isLast ? 'last' : ''}`}>
                <div className="unthreaded-tree-vertical" />
                <div className="unthreaded-tree-horizontal" />
              </div>
              <div className="unthreaded-tree-content">{row}</div>
            </div>
          );
        })}
      </div>
    );
  }

  render() {
    // Avoid building and reconciling an opacity-hidden duplicate message tree
    // while the normal thread list is in use.
    if (!this.state.enabled) {
      return this._renderCore();
    }

    const visibleItems = this._visibleItems();
    const groupedItems = this._groupedItems(visibleItems);
    const ungroupedSections = this._dateSections(visibleItems, (item) => item.message.date);
    const groupedSections = this._dateSections(groupedItems, (group) => group.latestDate);
    return (
      <div className="unthreaded-thread-list-wrap">
        <div className="unthreaded-thread-list-stage">
          <ScrollRegion className="unthreaded-thread-list">
            {this.state.loading ? <Spinner visible={true} /> : null}
            {this.state.layout === 'ungrouped'
              ? this._renderDateSections(ungroupedSections, (item, index, items) =>
                  this._renderItem(item, { isLast: index === items.length - 1 })
                )
              : this._renderDateSections(groupedSections, (group) => this._renderGroup(group))}
            {!this.state.loading && visibleItems.length === 0 ? (
              <div className="unthreaded-list-empty">
                {UnthreadedState.unreadOnly()
                  ? localized('No unread messages')
                  : localized('No messages')}
              </div>
            ) : null}
          </ScrollRegion>
        </div>
      </div>
    );
  }
}
