import { isWaylandSession } from './is-wayland';
import MailspringWindow from './mailspring-window';
import { MailspringWindowSettings } from './mailspring-window';
import { WINDOWS_COMPOSER_TITLE_BAR_OVERLAY } from '../windows-title-bar';

const DEBUG_SHOW_HOT_WINDOW = process.env.SHOW_HOT_WINDOW === 'true';
let winNum = 0;

export function isHotWindowReady(hotWindow?: Pick<MailspringWindow, 'isLoaded'>) {
  return !!hotWindow && hotWindow.isLoaded();
}

/**
 * It takes a full second or more to bootup a Mailspring window. Most of this
 * is due to sheer amount of time it takes to parse all of the javascript
 * and follow the require tree.
 *
 * Since popout windows need to be more responsive than that, we pre-load
 * "hot" windows in the background that have most of the code loaded. Then
 * all we need to do is load the handful of packages the window
 * requires and show it.
 */
export default class WindowLauncher {
  static EMPTY_WINDOW = 'emptyWindow';

  public hotWindow?: MailspringWindow;

  private _defaultWindowOpts: MailspringWindowSettings;
  private config: import('../config').default;
  private onCreatedHotWindow: (win: MailspringWindow) => void;

  constructor({
    devMode,
    safeMode,
    specMode,
    resourcePath,
    configDirPath,
    onCreatedHotWindow,
    config,
  }: {
    devMode: boolean;
    safeMode: boolean;
    specMode: boolean;
    resourcePath: string;
    configDirPath: string;
    onCreatedHotWindow: (win: MailspringWindow) => void;
    config: import('../config').default;
  }) {
    this._defaultWindowOpts = {
      // Secondary windows use native window chrome by default. Keeping the hot
      // window on the same chrome lets composer windows reuse it instead of
      // falling back to a full, cold renderer boot.
      frame: process.platform !== 'darwin',
      toolbar: process.platform !== 'linux',
      hidden: false,
      devMode,
      safeMode,
      resizable: true,
      windowType: WindowLauncher.EMPTY_WINDOW,
      bootstrapScript: require.resolve('../secondary-window-bootstrap'),
      resourcePath,
      configDirPath,
    };
    this.config = config;
    this.onCreatedHotWindow = onCreatedHotWindow;
    if (specMode) return;
    this.createHotWindow();
  }

  createDefaultWindowOpts() {
    const opts = Object.assign({}, this._defaultWindowOpts);

    // apply optional Linux properties
    if (process.platform === 'linux') {
      const style = this.config.get('core.workspace.menubarStyle');
      if (style === 'autohide') {
        opts.autoHideMenuBar = true;
      }
      if (style === 'hamburger' && opts.frame) {
        opts.toolbar = true;
        opts.frame = false;
      }
    }
    return opts;
  }

  newWindow(options) {
    const opts = Object.assign(this.createDefaultWindowOpts(), options);

    // Composer, popout, contacts, and other secondary Windows windows do not
    // render AppTabs, so retain their native frame unless a caller explicitly
    // requests otherwise (onboarding is intentionally frameless).
    if (
      process.platform === 'win32' &&
      opts.windowType !== WindowLauncher.EMPTY_WINDOW &&
      opts.windowType !== 'default'
    ) {
      if (options.frame == null) opts.frame = true;
      if (opts.windowType === 'composer') {
        // The composer renders a theme-aware drag region beneath Windows'
        // native caption buttons. Keep this identical to the preloaded hot
        // window so opening a composer does not regress to a cold renderer.
        opts.titleBarStyle = 'hidden';
        opts.titleBarOverlay = WINDOWS_COMPOSER_TITLE_BAR_OVERLAY;
      } else {
        // Other secondary windows do not render the composer title bar and
        // retain their explicitly requested native frame behavior.
        opts.titleBarStyle = options.titleBarStyle;
        opts.titleBarOverlay = options.titleBarOverlay;
      }
    }

    let win;

    // A hot window cannot receive load-settings-changed until its renderer has
    // finished startSecondaryWindow and registered the listener. Reusing it
    // before then loses the message and leaves a hidden empty window plus the
    // tray icon. This is most visible on a fast first launch after install.
    // Fall back to a cold window until the preload is fully ready.
    // On Wayland, always use cold windows - see createHotWindow comment below.
    if (this._mustUseColdWindow(opts) || isWaylandSession() || !isHotWindowReady(this.hotWindow)) {
      win = new MailspringWindow(opts);
    } else {
      win = this.hotWindow;

      const newLoadSettings = Object.assign({}, win.loadSettings(), opts);
      if (newLoadSettings.windowType === WindowLauncher.EMPTY_WINDOW) {
        throw new Error('Must specify a windowType');
      }

      // Reset the loaded state and update the load settings.
      // This will fire `AppEnv::populateHotWindow` and reload the
      // packages.
      win.windowKey = opts.windowKey || `${opts.windowType}-${winNum}`;
      winNum += 1;
      win.windowType = opts.windowType;

      if (options.bounds) {
        win.browserWindow.setBounds(options.bounds);
      }
      if (options.width && options.height) {
        win.browserWindow.setSize(options.width, options.height);
      }

      win.setLoadSettings(newLoadSettings);

      setTimeout(() => {
        // We need to regen a hot window, but do it in the next event
        // loop to not hang the opening of the current window.
        this.createHotWindow();
      }, 0);
    }

    if (!isWaylandSession() && !opts.initializeInBackground && !opts.hidden) {
      // NOTE: In the case of a cold window, this will show it once
      // loaded. If it's a hotWindow, since hotWindows have a
      // `hidden:true` flag, nothing will show. When `setLoadSettings`
      // starts populating the window in `populateHotWindow` we'll show or
      // hide based on the windowOpts
      win.showWhenLoaded();
    }
    // On Wayland, windows are shown via the did-finish-load handler in
    // mailspring-window.ts (at the point where the Wayland activation token
    // is still valid). We intentionally skip showWhenLoaded() here to avoid
    // a second browserWindow.focus() call at window:loaded time. By that
    // point React has rendered the composer's contenteditable with
    // spellCheck=true and Chromium has connected to IBus. The second focus()
    // triggers a blur/refocus cycle in the Wayland compositor that causes
    // IBus to lose and fail to re-establish its connection, freezing all
    // keyboard input in the compose window.
    //
    // When --background is requested on Wayland, the did-finish-load handler
    // shows briefly to commit the Wayland surface, then hides at window:loaded.
    return win;
  }

  createHotWindow() {
    // On Linux/Wayland, don't create hot windows. BrowserWindow.show() fails silently
    // for hidden windows when the Wayland activation context is missing, so we use cold
    // windows instead and show them immediately when loaded.
    if (isWaylandSession()) return;

    this.hotWindow = new MailspringWindow(this._hotWindowOpts());
    this.onCreatedHotWindow(this.hotWindow);
    if (DEBUG_SHOW_HOT_WINDOW) {
      this.hotWindow.showWhenLoaded();
    }
  }

  // Note: This method calls `browserWindow.destroy()` which closes
  // windows without waiting for them to load or firing window lifecycle
  // events.  This is necessary for the app to quit promptly on Linux.
  // https://phab.mailspring.com/T1282
  cleanupBeforeAppQuit() {
    if (this.hotWindow != null) {
      this.hotWindow.browserWindow.destroy();
    }
    this.hotWindow = null;
  }

  // Some properties, like the `frame` or `toolbar` can't be updated once
  // a window has been setup. If we detect this case we have to bootup a
  // plain MailspringWindow instead of using a hot window.
  _mustUseColdWindow(opts) {
    const { bootstrapScript, frame, titleBarStyle, titleBarOverlay } = this._hotWindowOpts();

    const usesOtherBootstrap = opts.bootstrapScript !== bootstrapScript;
    const usesOtherFrame = !!opts.frame !== frame;
    const usesOtherTitleBar =
      opts.titleBarStyle !== titleBarStyle ||
      JSON.stringify(opts.titleBarOverlay) !== JSON.stringify(titleBarOverlay);
    const requestsColdStart = opts.coldStartOnly;

    return usesOtherBootstrap || usesOtherFrame || usesOtherTitleBar || requestsColdStart;
  }

  _hotWindowOpts() {
    const hotWindowOpts = this.createDefaultWindowOpts();
    if (process.platform === 'win32') {
      hotWindowOpts.titleBarStyle = 'hidden';
      hotWindowOpts.titleBarOverlay = WINDOWS_COMPOSER_TITLE_BAR_OVERLAY;
    }
    hotWindowOpts.hidden = DEBUG_SHOW_HOT_WINDOW;
    return hotWindowOpts;
  }
}
