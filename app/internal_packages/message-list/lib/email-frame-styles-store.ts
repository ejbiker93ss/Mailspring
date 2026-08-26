import MailspringStore from 'mailspring-store';

const EMAIL_RENDER_MODE_KEY = 'core.reading.emailRenderMode';

class EmailFrameStylesStore extends MailspringStore {
  _styles?: string;
  _mutationObserver: MutationObserver;
  _configDisposable?: { dispose: () => void };

  constructor() {
    super();
    this._configDisposable = AppEnv.config.onDidChange(EMAIL_RENDER_MODE_KEY, this._findStyles);
  }

  styles() {
    if (!this._styles) {
      this._findStyles();
      this._listenToStyles();
    }
    return this._styles;
  }

  _findStyles = () => {
    const mode = this._emailRenderMode();
    this._styles = '';

    // Include the system accent CSS variables so that var(--system-accent, ...)
    // resolves correctly inside email iframes (which have their own document).
    const accentSheet = document.querySelector('[source-path="system-accent:dynamic"]');
    if (accentSheet) {
      this._styles += `\n${(accentSheet as HTMLElement).innerText}`;
    }

    // Always retain Mailspring's core message typography and layout, but never
    // allow the active app theme to recolor message content. Theme filters can
    // make ordinary dark email text unreadable and can turn photographs into
    // negatives. Message appearance is controlled explicitly by light/dark mode.
    for (const sheet of Array.from(
      document.querySelectorAll('[source-path*="email-frame.less"]')
    )) {
      if (this._isCoreEmailFrameStylesheet(sheet)) {
        this._styles += `\n${(sheet as HTMLElement).innerText}`;
      }
    }
    this._styles = this._styles.replace(/.ignore-in-parent-frame/g, '');
    this._styles += this._emailRenderModeOverrideStyles(mode);
    this.trigger();
  };

  _emailRenderMode() {
    return AppEnv.config.get(EMAIL_RENDER_MODE_KEY) === 'dark' ? 'dark' : 'light';
  }

  _isCoreEmailFrameStylesheet(sheet: Element) {
    const sourcePath = (sheet.getAttribute('source-path') || '').replace(/\\/g, '/');
    return sourcePath.includes('/static/style/email-frame.less');
  }

  _emailRenderModeOverrideStyles(mode = this._emailRenderMode()) {
    if (mode === 'light') {
      return (
        '\nbody { filter: none !important; color: #111 !important; }' +
        '\nimg { filter: none !important; }'
      );
    }
    if (mode === 'dark') {
      return (
        '\nbody { filter: invert(100%) hue-rotate(180deg) !important; color: #111 !important; }' +
        '\nimg { filter: invert(100%) hue-rotate(180deg) !important; }'
      );
    }
    return '';
  }

  _listenToStyles() {
    const target = document.getElementsByTagName('managed-styles')[0];
    this._mutationObserver = new MutationObserver(this._findStyles);
    this._mutationObserver.observe(target, { attributes: true, subtree: true, childList: true });
  }

  _unlistenToStyles() {
    if (this._mutationObserver) {
      this._mutationObserver.disconnect();
    }
    if (this._configDisposable) {
      this._configDisposable.dispose();
      this._configDisposable = undefined;
    }
  }
}

export { EmailFrameStylesStore };
export default new EmailFrameStylesStore();
