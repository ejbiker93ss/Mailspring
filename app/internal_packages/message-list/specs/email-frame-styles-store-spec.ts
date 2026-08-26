import fs from 'fs';
import path from 'path';

import { EmailFrameStylesStore } from '../lib/email-frame-styles-store';

const CATPPUCCIN_DARK_VARIANTS = [
  'Aura',
  'Frappe',
  'Macchiato',
  'Mocha',
  'RichBlue',
  'RichGreen',
  'RichPurple',
  'RichRed',
];

describe('EmailFrameStylesStore', () => {
  let store: EmailFrameStylesStore;
  let coreSheet: HTMLStyleElement;
  let themeSheet: HTMLStyleElement;
  let accentSheet: HTMLStyleElement;

  beforeEach(() => {
    coreSheet = document.createElement('style');
    coreSheet.setAttribute('source-path', '/static/style/email-frame.less');
    coreSheet.innerText = '.ignore-in-parent-frame body { font-family: test; color: #222; }';
    document.head.appendChild(coreSheet);

    themeSheet = document.createElement('style');
    themeSheet.setAttribute('source-path', '/themes/example/email-frame.less');
    themeSheet.innerText = '.ignore-in-parent-frame #inbox-html-wrapper { filter: invert(100%); }';
    document.head.appendChild(themeSheet);

    accentSheet = document.createElement('style');
    accentSheet.setAttribute('source-path', 'system-accent:dynamic');
    accentSheet.innerText = ':root { --system-accent: #123456; }';
    document.head.appendChild(accentSheet);

    store = new EmailFrameStylesStore();
  });

  afterEach(() => {
    store._unlistenToStyles();
    coreSheet.remove();
    themeSheet.remove();
    accentSheet.remove();
  });

  const renderMode = (mode: string) => {
    spyOn(AppEnv.config, 'get').andReturn(mode);
    store._findStyles();
    return store.styles();
  };

  it('keeps app theme frame styles out of legacy theme mode', () => {
    const styles = renderMode('theme');

    expect(styles).not.toContain('#inbox-html-wrapper { filter: invert(100%); }');
    expect(styles).toContain('body { font-family: test; color: #222; }');
    expect(styles).toContain('color: #111 !important;');
    expect(styles).not.toContain('.ignore-in-parent-frame');
    expect(styles).toContain('--system-accent:');
  });

  it('replaces theme message filters in forced dark mode', () => {
    const styles = renderMode('dark');

    expect(styles).not.toContain('#inbox-html-wrapper { filter: invert(100%); }');
    expect(styles).toContain('body { font-family: test; color: #222; }');
    expect(styles).toContain('body { filter: invert(100%) hue-rotate(180deg) !important;');
    expect(styles).toContain('img { filter: invert(100%) hue-rotate(180deg) !important; }');
    expect(styles).toContain('--system-accent:');
  });

  it('replaces theme message filters in forced light mode', () => {
    const styles = renderMode('light');

    expect(styles).not.toContain('#inbox-html-wrapper { filter: invert(100%); }');
    expect(styles).toContain('body { font-family: test; color: #222; }');
    expect(styles).toContain('body { filter: none !important; color: #111 !important; }');
    expect(styles).toContain('img { filter: none !important; }');
    expect(styles).toContain('--system-accent:');
  });

  it('defaults to light mode when no preference is saved', () => {
    const styles = renderMode(undefined);

    expect(styles).not.toContain('#inbox-html-wrapper { filter: invert(100%); }');
    expect(styles).toContain('body { font-family: test; color: #222; }');
    expect(styles).toContain('color: #111 !important;');
  });

  it('falls back to light mode for a legacy or invalid saved value', () => {
    const styles = renderMode('unexpected');

    expect(styles).not.toContain('#inbox-html-wrapper { filter: invert(100%); }');
    expect(styles).toContain('color: #111 !important;');
  });

  it('corrects forwarded signature tables without a nesting-depth limit', () => {
    const { resourcePath } = AppEnv.getLoadSettings();

    for (const variant of CATPPUCCIN_DARK_VARIANTS) {
      const stylesheet = fs.readFileSync(
        path.join(
          resourcePath,
          'internal_packages',
          `Catppuccin-${variant}`,
          'styles',
          'email-frame.less'
        ),
        'utf8'
      );

      expect(stylesheet).toContain('table:not(table table)');
      expect(stylesheet).toContain('img:not(table img)');
      expect(stylesheet).not.toContain('> :not(table) > :not(table) > table');
    }
  });

  it('does not invert messages in the light Catppuccin Latte theme', () => {
    const { resourcePath } = AppEnv.getLoadSettings();
    const stylesheet = fs.readFileSync(
      path.join(
        resourcePath,
        'internal_packages',
        'Catppuccin-Latte',
        'styles',
        'email-frame.less'
      ),
      'utf8'
    );

    expect(stylesheet).not.toContain('@message-filter');
    expect(stylesheet).not.toContain('invert(');
  });
});
