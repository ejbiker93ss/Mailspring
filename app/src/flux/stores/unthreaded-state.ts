/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- Ported legacy plugin module; compiled by the first-party TypeScript pipeline.
import SummerMailStore from 'summermail-store';
import { MAIL_SORT_FIELDS } from '../../services/mail-sort';

// One quick filter applies to the mail list at a time.
export const MAIL_QUICK_FILTERS = ['all', 'unread', 'starred'];

class UnthreadedState extends SummerMailStore {
  constructor() {
    super();
    this._enabled = this._loadEnabled();
    this._layout = this._loadLayout();
    this._sortAscending = this._loadBoolean('summermail-unthreaded:sort-ascending', false);
    this._sortField = this._loadSortField();
    this._quickFilter = this._loadQuickFilter();
    this._selected = null;
  }

  // Older profiles only stored the unread toggle, so fall back to it.
  _loadQuickFilter() {
    try {
      const value = window.localStorage.getItem('summermail-unthreaded:quick-filter');
      if (MAIL_QUICK_FILTERS.includes(value)) return value;
    } catch (err) {
      // Fall through to the legacy unread flag.
    }
    return this._loadBoolean('summermail-unthreaded:unread-only', false) ? 'unread' : 'all';
  }

  _loadBoolean(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value === 'true';
    } catch (err) {
      return fallback;
    }
  }

  _loadSortField() {
    try {
      const value = window.localStorage.getItem('summermail-unthreaded:sort-field');
      return MAIL_SORT_FIELDS.includes(value) ? value : 'relevance';
    } catch (err) {
      return 'relevance';
    }
  }

  sortField() {
    return this._sortField;
  }

  setSortField = (field) => {
    if (!MAIL_SORT_FIELDS.includes(field)) return;
    this._sortField = field;
    this._sortAscending = field === 'from' || field === 'subject';
    try {
      window.localStorage.setItem('summermail-unthreaded:sort-field', field);
      window.localStorage.setItem(
        'summermail-unthreaded:sort-ascending',
        String(this._sortAscending)
      );
    } catch (err) {
      // Sorting still works when renderer storage is unavailable.
    }
    this.trigger();
  };

  _loadEnabled() {
    try {
      const value = window.localStorage.getItem('summermail-unthreaded:enabled');
      return value === null ? true : value === 'true';
    } catch (err) {
      return true;
    }
  }

  _loadLayout() {
    try {
      const value = window.localStorage.getItem('summermail-unthreaded:layout');
      return value === 'ungrouped' ? 'ungrouped' : 'grouped';
    } catch (err) {
      return 'grouped';
    }
  }

  enabled() {
    return this._enabled;
  }

  layout() {
    return this._layout;
  }

  isGrouped() {
    return this._layout !== 'ungrouped';
  }

  selected() {
    return this._selected;
  }

  sortAscending() {
    return this._sortAscending;
  }

  quickFilter() {
    return this._quickFilter;
  }

  unreadOnly() {
    return this._quickFilter === 'unread';
  }

  starredOnly() {
    return this._quickFilter === 'starred';
  }

  toggleSort = () => {
    if (this._sortField === 'relevance') this._sortField = 'date';
    this._sortAscending = !this._sortAscending;
    try {
      window.localStorage.setItem('summermail-unthreaded:sort-field', this._sortField);
      window.localStorage.setItem(
        'summermail-unthreaded:sort-ascending',
        String(this._sortAscending)
      );
    } catch (err) {
      // localStorage may be unavailable in restricted renderer contexts.
    }
    this.trigger();
  };

  setQuickFilter = (filter) => {
    if (!MAIL_QUICK_FILTERS.includes(filter) || filter === this._quickFilter) return;
    this._quickFilter = filter;
    try {
      window.localStorage.setItem('summermail-unthreaded:quick-filter', filter);
      window.localStorage.setItem('summermail-unthreaded:unread-only', String(filter === 'unread'));
    } catch (err) {
      // localStorage may be unavailable in restricted renderer contexts.
    }
    this.trigger();
  };

  toggleUnreadOnly = () => {
    this.setQuickFilter(this._quickFilter === 'unread' ? 'all' : 'unread');
  };

  setEnabled = (enabled) => {
    if (this._enabled === enabled) {
      return;
    }
    this._enabled = enabled;
    try {
      window.localStorage.setItem('summermail-unthreaded:enabled', String(enabled));
    } catch (err) {
      // localStorage may be unavailable in restricted renderer contexts.
    }
    this.trigger();
  };

  toggleEnabled = () => {
    this.setEnabled(!this._enabled);
  };

  setLayout = (layout) => {
    const nextLayout = layout === 'ungrouped' ? 'ungrouped' : 'grouped';
    if (this._layout === nextLayout) {
      return;
    }
    this._layout = nextLayout;
    try {
      window.localStorage.setItem('summermail-unthreaded:layout', nextLayout);
    } catch (err) {
      // localStorage may be unavailable in restricted renderer contexts.
    }
    this.trigger();
  };

  setSelected = (selected) => {
    const currentId = this._selected && this._selected.message && this._selected.message.id;
    const nextId = selected && selected.message && selected.message.id;
    if (currentId === nextId) {
      return;
    }
    this._selected = selected;
    this.trigger();
  };

  ensureValidSelection = (items) => {
    const selectedId = this._selected && this._selected.message && this._selected.message.id;
    const nextSelection = items[0] || null;
    if (
      (!this._selected && !nextSelection) ||
      (selectedId && items.find((item) => item.message.id === selectedId))
    ) {
      return;
    }
    this._selected = nextSelection;
    this.trigger();
  };
}

export default new UnthreadedState();
