import WindowLauncher, { isHotWindowReady } from '../src/browser/window-launcher';
import { EventEmitter } from 'events';

describe('WindowLauncher hot window readiness', () => {
  it('does not reuse a preloaded window before its renderer is ready', () => {
    const hotWindow = { isLoaded: jasmine.createSpy('isLoaded').andReturn(false) };

    expect(isHotWindowReady(hotWindow)).toBe(false);
  });

  it('reuses a preloaded window after its renderer is ready', () => {
    const hotWindow = { isLoaded: jasmine.createSpy('isLoaded').andReturn(true) };

    expect(isHotWindowReady(hotWindow)).toBe(true);
  });

  it('does not reuse a missing preloaded window', () => {
    expect(isHotWindowReady(undefined)).toBe(false);
  });

  it('preloads Windows secondary windows with composer-ready themed chrome', () => {
    if (process.platform !== 'win32') return;

    const launcher = new WindowLauncher({
      devMode: false,
      safeMode: false,
      specMode: true,
      resourcePath: '',
      configDirPath: '',
      onCreatedHotWindow: () => {},
      config: { get: () => undefined } as any,
    });
    const options = launcher._hotWindowOpts();

    expect(options.frame).toBe(true);
    expect(options.titleBarStyle).toBe('hidden');
    expect(options.titleBarOverlay).toEqual({
      color: '#111111',
      symbolColor: '#ffffff',
      height: 40,
    });
  });

  it('keeps the themed Windows composer compatible with the hot window', () => {
    if (process.platform !== 'win32') return;

    const launcher = new WindowLauncher({
      devMode: false,
      safeMode: false,
      specMode: true,
      resourcePath: '',
      configDirPath: '',
      onCreatedHotWindow: () => {},
      config: { get: () => undefined } as any,
    });
    const options = launcher.createDefaultWindowOpts();
    Object.assign(options, {
      windowType: 'composer',
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#111111',
        symbolColor: '#ffffff',
        height: 40,
      },
    });

    expect(launcher._mustUseColdWindow(options)).toBeFalsy();
  });
});

describe('WindowLauncher spare renderer scheduling', () => {
  let launcher: WindowLauncher;
  let browserWindow: EventEmitter;
  let createHotWindow: jasmine.Spy;

  beforeEach(() => {
    launcher = new WindowLauncher({
      devMode: false,
      safeMode: false,
      specMode: true,
      resourcePath: '',
      configDirPath: '',
      onCreatedHotWindow: () => {},
      config: { get: () => undefined } as any,
    });
    browserWindow = Object.assign(new EventEmitter(), { isVisible: () => false });
    launcher.hotWindow = {
      isLoaded: () => true,
      loadSettings: () => ({}),
      setLoadSettings: () => {},
      browserWindow,
    } as any;
    createHotWindow = spyOn(launcher, 'createHotWindow');
  });

  afterEach(() => launcher.cleanupBeforeAppQuit());

  it('waits for the composer to appear before starting its replacement renderer', () => {
    launcher.newWindow({ windowType: 'composer', hidden: true });
    expect(launcher.hotWindow).toBe(undefined);
    advanceClock(1000);
    expect(createHotWindow).not.toHaveBeenCalled();

    browserWindow.emit('show');
    advanceClock(249);
    expect(createHotWindow).not.toHaveBeenCalled();
    advanceClock(1);
    expect(createHotWindow.callCount).toBe(1);
    browserWindow.emit('closed');
    advanceClock(250);
    expect(createHotWindow.callCount).toBe(1);
  });

  it('replaces a consumed window that closes before it can be shown', () => {
    launcher.newWindow({ windowType: 'composer', hidden: true });
    browserWindow.emit('closed');
    advanceClock(250);
    expect(createHotWindow.callCount).toBe(1);
  });

  it('does not start another renderer after shutdown', () => {
    launcher.newWindow({ windowType: 'composer', hidden: true });
    browserWindow.emit('show');
    launcher.cleanupBeforeAppQuit();
    advanceClock(1000);
    expect(createHotWindow).not.toHaveBeenCalled();
  });
});
