/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- Ported legacy plugin module; compiled by the first-party TypeScript pipeline.
import { React } from 'mailspring-exports';

import UnthreadedState from '../../../src/flux/stores/unthreaded-state';

export default class UnthreadedToolbarToggle extends React.Component {
  static displayName = 'UnthreadedToolbarToggle';

  _rootEl = null;

  constructor(props) {
    super(props);
    this.state = {
      enabled: UnthreadedState.enabled(),
      layout: UnthreadedState.layout(),
      open: false,
    };
  }

  componentDidMount() {
    this._unlisten = UnthreadedState.listen(this._onChange);
    document.addEventListener('mousedown', this._onDocumentMouseDown, true);
  }

  componentWillUnmount() {
    if (this._unlisten) {
      this._unlisten();
      this._unlisten = null;
    }
    document.removeEventListener('mousedown', this._onDocumentMouseDown, true);
  }

  _onChange = () => {
    this.setState({
      enabled: UnthreadedState.enabled(),
      layout: UnthreadedState.layout(),
    });
  };

  _setEnabled = (enabled) => {
    UnthreadedState.setEnabled(enabled);
    if (!enabled) this.setState({ open: false });
  };

  _setLayout = (layout) => {
    UnthreadedState.setLayout(layout);
    this.setState({ open: false });
  };

  _onDocumentMouseDown = (event) => {
    if (!this.state.open || !this._rootEl || this._rootEl.contains(event.target)) return;
    this.setState({ open: false });
  };

  _onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.setState({ open: false });
    }
  };

  _check = (active) => (
    <span className={`thread-view-menu-check ${active ? 'active' : ''}`} aria-hidden="true">
      {active ? '✓' : ''}
    </span>
  );

  render() {
    const label = this.state.enabled
      ? this.state.layout === 'grouped'
        ? 'Unthreaded, grouped'
        : 'Unthreaded, ungrouped'
      : 'Threaded';

    return (
      <div
        className="thread-view-menu-wrap"
        data-unthreaded-toolbar-toggle
        ref={(el) => (this._rootEl = el)}
        onKeyDown={this._onKeyDown}
      >
        <button
          className={`thread-view-menu-trigger ${this.state.open ? 'active' : ''}`}
          title={`Message list view: ${label}`}
          aria-label={`Message list view: ${label}`}
          aria-haspopup="menu"
          aria-expanded={this.state.open}
          onClick={() => this.setState({ open: !this.state.open })}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M5 7h14M5 12h14M5 17h14" />
            <path d="M8 5v4M15 10v4M10 15v4" />
          </svg>
        </button>
        {this.state.open ? (
          <div className="thread-view-menu" role="menu" aria-label="Message list view">
            <div className="thread-view-menu-label">Conversation view</div>
            <button
              className={!this.state.enabled ? 'selected' : ''}
              role="menuitemradio"
              aria-checked={!this.state.enabled}
              onClick={() => this._setEnabled(false)}
            >
              {this._check(!this.state.enabled)}
              <span>
                <strong>Threaded</strong>
                <small>One card per conversation</small>
              </span>
            </button>
            <button
              className={this.state.enabled ? 'selected' : ''}
              role="menuitemradio"
              aria-checked={this.state.enabled}
              onClick={() => this._setEnabled(true)}
            >
              {this._check(this.state.enabled)}
              <span>
                <strong>Unthreaded</strong>
                <small>Show individual messages</small>
              </span>
            </button>

            <div className={`thread-view-submenu ${this.state.enabled ? '' : 'disabled'}`}>
              <div className="thread-view-menu-label">Unthreaded layout</div>
              <button
                className={this.state.enabled && this.state.layout === 'grouped' ? 'selected' : ''}
                role="menuitemradio"
                aria-checked={this.state.enabled && this.state.layout === 'grouped'}
                disabled={!this.state.enabled}
                onClick={() => this._setLayout('grouped')}
              >
                {this._check(this.state.enabled && this.state.layout === 'grouped')}
                <span>
                  <strong>Grouped</strong>
                  <small>Keep messages together by conversation</small>
                </span>
              </button>
              <button
                className={
                  this.state.enabled && this.state.layout === 'ungrouped' ? 'selected' : ''
                }
                role="menuitemradio"
                aria-checked={this.state.enabled && this.state.layout === 'ungrouped'}
                disabled={!this.state.enabled}
                onClick={() => this._setLayout('ungrouped')}
              >
                {this._check(this.state.enabled && this.state.layout === 'ungrouped')}
                <span>
                  <strong>Ungrouped</strong>
                  <small>Use one flat chronological list</small>
                </span>
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }
}
