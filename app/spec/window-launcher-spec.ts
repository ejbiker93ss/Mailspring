import WindowLauncher, { isHotWindowReady } from '../src/browser/window-launcher';

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

  it('preloads Windows secondary windows with native chrome', () => {
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

    expect(options.frame).toBe(true);
    expect(options.titleBarStyle).toBeUndefined();
    expect(options.titleBarOverlay).toBeUndefined();
  });
});
