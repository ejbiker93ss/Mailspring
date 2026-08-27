/* eslint react/sort-comp: 0 */
import _ from 'underscore';
import React from 'react';
import {
  Message,
  localized,
  DraftStore,
  WorkspaceStore,
  ComponentRegistry,
  InflatesDraftClientId,
} from 'mailspring-exports';
import ComposerView from './composer-view';
import { electronHexColor, WINDOWS_TITLE_BAR_HEIGHT } from '../../../src/windows-title-bar';

const ComposerViewForDraftClientId = InflatesDraftClientId(ComposerView);

class ComposerWindowTitleBar extends React.Component<{ title: string }, { title: string }> {
  private titleBar = React.createRef<HTMLElement>();
  private themeDisposable?: { dispose: () => void };
  private nativeColorSyncTimers: number[] = [];

  constructor(props) {
    super(props);
    this.state = { title: props.title };
  }

  componentDidMount() {
    this.themeDisposable = AppEnv.themes.onDidChangeActiveThemes(this._queueNativeColorSync);
    window.addEventListener('focus', this._queueNativeColorSync);
    this._queueNativeColorSync();
  }

  componentWillUnmount() {
    this.themeDisposable?.dispose();
    window.removeEventListener('focus', this._queueNativeColorSync);
    this.nativeColorSyncTimers.forEach((timer) => window.clearTimeout(timer));
  }

  setTitle(title: string) {
    if (title !== this.state.title) this.setState({ title });
  }

  _queueNativeColorSync = () => {
    if (process.platform !== 'win32') return;
    this.nativeColorSyncTimers.forEach((timer) => window.clearTimeout(timer));
    this.nativeColorSyncTimers = [0, 75, 300, 1000].map((delay) =>
      window.setTimeout(this._syncNativeColors, delay)
    );
  };

  _syncNativeColors = () => {
    window.requestAnimationFrame(() => {
      if (!this.titleBar.current) return;
      const style = window.getComputedStyle(this.titleBar.current);
      const color = electronHexColor(style.backgroundColor);
      const symbolColor = electronHexColor(style.color);
      if (!color || !symbolColor) return;
      AppEnv.getCurrentWindow().setTitleBarOverlay({
        color,
        symbolColor,
        height: WINDOWS_TITLE_BAR_HEIGHT,
      });
    });
  };

  _onDoubleClick = () => {
    const win = AppEnv.getCurrentWindow();
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  };

  render() {
    return (
      <header
        ref={this.titleBar}
        className="composer-window-titlebar"
        onDoubleClick={this._onDoubleClick}
      >
        <span className="composer-window-app-mark" aria-hidden="true">
          <svg viewBox="0 0 20 20">
            <path d="M3.25 5.25h13.5v9.5H3.25z" />
            <path d="m3.75 6 6.25 5 6.25-5" />
          </svg>
        </span>
        <span className="composer-window-title" title={this.state.title}>
          {this.state.title}
        </span>
      </header>
    );
  }
}

class ComposerWithWindowProps extends React.Component<
  Record<string, unknown>,
  { headerMessageId: string; errorMessage?: string; errorDetail?: string }
> {
  static displayName = 'ComposerWithWindowProps';
  static containerRequired = false;

  _usub?: () => void;
  _composerComponent?: any;
  _titleBar?: ComposerWindowTitleBar;
  _windowTitle: string;

  constructor(props) {
    super(props);

    // We'll now always have windowProps by the time we construct this.
    const windowProps = AppEnv.getWindowProps();
    const { draftJSON, headerMessageId, newDraft } = windowProps;
    if (!draftJSON) {
      throw new Error('Initialize popout composer windows with valid draftJSON');
    }
    const draft = new Message({}).fromJSON(draftJSON);
    DraftStore._createSession(headerMessageId, draft);
    this.state = windowProps;

    // Set the OS window title immediately based on the draft subject (if any)
    const subject = draft.subject && draft.subject.trim();
    this._windowTitle = subject || (newDraft ? localized('New Message') : localized('Message'));
    AppEnv.getCurrentWindow().setTitle(this._windowTitle);
  }

  componentWillUnmount() {
    if (this._usub) {
      this._usub();
    }
  }

  componentDidUpdate() {
    this._composerComponent.focus();
  }

  _onDraftReady = async () => {
    await this._composerComponent.focus();

    // Subscribe to draft changes to keep the OS window title up to date as the user types
    const { newDraft } = AppEnv.getWindowProps();
    const session = await DraftStore.sessionForClientId(this.state.headerMessageId);
    this._usub = session.listen(() => {
      const d = session.draft();
      if (!d) return;
      const subject = d.subject && d.subject.trim();
      this._windowTitle = subject || (newDraft ? localized('New Message') : localized('Message'));
      AppEnv.getCurrentWindow().setTitle(this._windowTitle);
      this._titleBar?.setTitle(this._windowTitle);
    });

    AppEnv.displayWindow();

    if (this.state.errorMessage) {
      this._showInitialErrorDialog(this.state.errorMessage, this.state.errorDetail);
    }
  };

  render() {
    return (
      <div className="composer-window-shell">
        {process.platform === 'win32' ? (
          <ComposerWindowTitleBar
            ref={(titleBar) => {
              this._titleBar = titleBar;
            }}
            title={this._windowTitle}
          />
        ) : null}
        <div className="composer-window-content">
          <ComposerViewForDraftClientId
            ref={(cm) => {
              this._composerComponent = cm;
            }}
            onDraftReady={this._onDraftReady}
            headerMessageId={this.state.headerMessageId}
            className="composer-full-window"
          />
        </div>
      </div>
    );
  }

  _showInitialErrorDialog(msg: string, detail: string) {
    // We delay so the view has time to update the restored draft. If we
    // don't delay the modal may come up in a state where the draft looks
    // like it hasn't been restored or has been lost.
    _.delay(() => {
      AppEnv.showErrorDialog({ title: localized('Error'), message: msg }, { detail: detail });
    }, 100);
  }
}

export function activate() {
  if (AppEnv.isMainWindow()) {
    ComponentRegistry.register(ComposerViewForDraftClientId, {
      role: 'Composer',
    });
  } else if (AppEnv.isThreadWindow()) {
    ComponentRegistry.register(ComposerViewForDraftClientId, {
      role: 'Composer',
    });
  } else {
    AppEnv.getCurrentWindow().setMinimumSize(480, 250);
    ComponentRegistry.register(ComposerWithWindowProps, {
      location: WorkspaceStore.Location.Center,
    });
  }

  setTimeout(() => {
    // preload the font awesome icons used in the composer after a short delay.
    // unfortunately, the icon set takes enough time to load that it introduces jank
    const i = document.createElement('i');
    i.className = 'fa fa-list';
    i.style.position = 'absolute';
    i.style.top = '-20px';
    document.body.appendChild(i);
  }, 1000);
}

export function deactivate() {
  if (AppEnv.isMainWindow()) {
    ComponentRegistry.unregister(ComposerViewForDraftClientId);
  } else {
    ComponentRegistry.unregister(ComposerWithWindowProps);
  }
}

export function serialize() {
  return this.state;
}
