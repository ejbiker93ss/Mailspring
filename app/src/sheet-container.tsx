import React from 'react';
import { CSSTransition, TransitionGroup } from 'react-transition-group';
import { localized, WorkspaceStore } from 'mailspring-exports';

import Sheet from './sheet';
import Toolbar from './sheet-toolbar';
import { Flexbox } from './components/flexbox';
import { InjectedComponentSet } from './components/injected-component-set';
import { SheetDeclaration } from './flux/stores/workspace-store';
import AppTabs from './app-tabs';
import { Disposable } from 'rx-core';

interface SheetContainerState {
  stack: SheetDeclaration[];
  mode: string;
  windowType: string;
  error?: string;
}

export default class SheetContainer extends React.Component<
  Record<string, unknown>,
  SheetContainerState
> {
  static displayName = 'SheetContainer';

  _toolbarComponents = {};
  unsubscribe?: () => void;
  windowPropsDisposable?: Disposable;
  _scrollbarHideTimers = new Map<HTMLElement, number>();

  constructor(props) {
    super(props);
    this.state = this._getStateFromStores();
  }

  componentDidMount() {
    this.unsubscribe = WorkspaceStore.listen(this._onStoreChange);
    this.windowPropsDisposable = AppEnv.onWindowPropsReceived(this._onWindowPropsReceived);
    document.addEventListener('scroll', this._onWorkspaceScroll, true);
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // We don't currently display the error, but we need to call setState within
    // this function or the component does not re-render after being reset.
    this.setState({ error: error.stack });
    AppEnv.reportError(error);
  }

  componentWillUnmount() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    if (this.windowPropsDisposable) {
      this.windowPropsDisposable.dispose();
    }
    document.removeEventListener('scroll', this._onWorkspaceScroll, true);
    this._scrollbarHideTimers.forEach((timer, element) => {
      window.clearTimeout(timer);
      element.classList.remove('scrollbar-active');
    });
    this._scrollbarHideTimers.clear();
  }

  _onWorkspaceScroll = (event: Event) => {
    const element = event.target;
    if (!(element instanceof HTMLElement)) return;

    element.classList.add('scrollbar-active');
    const previousTimer = this._scrollbarHideTimers.get(element);
    if (previousTimer) window.clearTimeout(previousTimer);

    const timer = window.setTimeout(() => {
      element.classList.remove('scrollbar-active');
      this._scrollbarHideTimers.delete(element);
    }, 650);
    this._scrollbarHideTimers.set(element, timer);
  };

  _getStateFromStores() {
    return {
      stack: WorkspaceStore.sheetStack(),
      mode: WorkspaceStore.layoutMode(),
      windowType: AppEnv.getWindowType(),
    };
  }

  _onColumnSizeChanged = (sheet: Sheet) => {
    const toolbar = this._toolbarComponents[sheet.props.depth];
    if (toolbar) {
      toolbar.recomputeLayout();
    }
    window.dispatchEvent(new Event('resize'));
  };

  _onStoreChange = () => {
    this.setState(this._getStateFromStores());
  };

  _onWindowPropsReceived = () => {
    this.setState(this._getStateFromStores());
  };

  _lastToolbarClickTime = 0;

  _onToolbarDoubleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (process.platform !== 'darwin') return;
    if (e.target instanceof HTMLElement) {
      if (['INPUT', 'A', 'BUTTON'].includes(e.target.tagName)) return;
      if (e.target.hasAttribute('contenteditable')) return;
    }

    if (Date.now() - this._lastToolbarClickTime < 350) {
      const win = AppEnv.getCurrentWindow();
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
    this._lastToolbarClickTime = Date.now();
  };

  _toolbarContainerElement() {
    const { toolbar } = AppEnv.getLoadSettings();
    const topSheet = WorkspaceStore.topSheet();
    if (
      !toolbar ||
      (process.platform === 'win32' && this.state.windowType === 'composer') ||
      WorkspaceStore.rootSheet() === WorkspaceStore.Sheet.Conversation ||
      topSheet === WorkspaceStore.Sheet.Preferences
    ) {
      return [];
    }

    const components = this.state.stack.map((sheet, index) => (
      <Toolbar
        data={sheet}
        ref={(cm) => {
          this._toolbarComponents[index] = cm;
        }}
        key={`${index}:${sheet.id}:toolbar`}
        depth={index}
      />
    ));

    return (
      <header
        className="sheet-toolbar"
        role="banner"
        aria-label={localized('Application toolbar')}
        style={{ order: 0, zIndex: 3 }}
        onClick={this._onToolbarDoubleClick}
      >
        <div inert={this.state.stack.length > 1 ? '' : undefined}>{components[0]}</div>
        <TransitionGroup component={null}>
          {components.slice(1).map((comp) => (
            <CSSTransition key={comp.key} classNames="opacity-125ms" timeout={125}>
              {comp}
            </CSSTransition>
          ))}
        </TransitionGroup>
      </header>
    );
  }

  render() {
    const totalSheets = this.state.stack.length;
    const topSheet = this.state.stack[totalSheets - 1];

    if (!topSheet) {
      return <div />;
    }

    const sheetComponents = this.state.stack.map((sheet, index) => (
      <Sheet
        data={sheet}
        depth={index}
        key={index > 0 ? `${index}:${sheet.id}` : `root`}
        onColumnSizeChanged={this._onColumnSizeChanged}
      />
    ));

    return (
      <Flexbox
        direction="column"
        className={`layout-mode-${this.state.mode}`}
        style={{ overflow: 'hidden' }}
      >
        {process.platform === 'win32' && AppEnv.isMainWindow() ? <AppTabs /> : null}
        {this._toolbarContainerElement()}

        <div style={{ order: 1, zIndex: 2 }}>
          <InjectedComponentSet
            matching={{ locations: [topSheet.Header, WorkspaceStore.Sheet.Global.Header] }}
            direction="column"
            id={topSheet.id}
          />
        </div>

        <main
          style={{ order: 2, flex: 1, position: 'relative', zIndex: 1 }}
          aria-label={localized('Email workspace')}
        >
          <div inert={totalSheets > 1 ? '' : undefined}>{sheetComponents[0]}</div>
          <TransitionGroup component={null}>
            {sheetComponents.slice(1).map((comp) => (
              <CSSTransition key={comp.key} classNames="sheet-stack" timeout={125}>
                {comp}
              </CSSTransition>
            ))}
          </TransitionGroup>
        </main>

        <footer style={{ order: 3, zIndex: 4 }}>
          <InjectedComponentSet
            matching={{ locations: [topSheet.Footer, WorkspaceStore.Sheet.Global.Footer] }}
            direction="column"
            id={topSheet.id}
          />
        </footer>
      </Flexbox>
    );
  }
}
