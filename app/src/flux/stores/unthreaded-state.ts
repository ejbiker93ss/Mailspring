/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- Ported legacy plugin module; compiled by the first-party TypeScript pipeline.
import MailspringStore from 'mailspring-store';

class UnthreadedState extends MailspringStore {
  constructor() {
    super();
    this._enabled = this._loadEnabled();
    this._layout = this._loadLayout();
    this._sortAscending = this._loadBoolean('mailspring-unthreaded:sort-ascending', false);
    this._unreadOnly = this._loadBoolean('mailspring-unthreaded:unread-only', false);
    this._selected = null;
  }

  _loadBoolean(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value === 'true';
    } catch (err) {
      return fallback;
    }
  }

  _loadEnabled() {
    try {
      const value = window.localStorage.getItem('mailspring-unthreaded:enabled');
      return value === null ? true : value === 'true';
    } catch (err) {
      return true;
    }
  }

  _loadLayout() {
    try {
      const value = window.localStorage.getItem('mailspring-unthreaded:layout');
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

  unreadOnly() {
    return this._unreadOnly;
  }

  toggleSort = () => {
    this._sortAscending = !this._sortAscending;
    try {
      window.localStorage.setItem(
        'mailspring-unthreaded:sort-ascending',
        String(this._sortAscending)
      );
    } catch (err) {
      // localStorage may be unavailable in restricted renderer contexts.
    }
    this.trigger();
  };

  toggleUnreadOnly = () => {
    this._unreadOnly = !this._unreadOnly;
    try {
      window.localStorage.setItem('mailspring-unthreaded:unread-only', String(this._unreadOnly));
    } catch (err) {
      // localStorage may be unavailable in restricted renderer contexts.
    }
    this.trigger();
  };

  setEnabled = (enabled) => {
    if (this._enabled === enabled) {
      return;
    }
    this._enabled = enabled;
    try {
      window.localStorage.setItem('mailspring-unthreaded:enabled', String(enabled));
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
      window.localStorage.setItem('mailspring-unthreaded:layout', nextLayout);
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
