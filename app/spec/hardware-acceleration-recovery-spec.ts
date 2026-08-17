const {
  attemptEarlyRendererCrashRecovery,
  isPrimaryWindowForRecovery,
  markerPath,
  preparePersistentSoftwareRendering,
  resetRecoveryStateForTests,
  shouldRecoverFromEarlyRendererCrash,
} = require('../src/browser/hardware-acceleration-recovery');

describe('Windows hardware acceleration recovery', () => {
  beforeEach(() => resetRecoveryStateForTests());

  it('treats both onboarding and the main mail window as recoverable primary windows', () => {
    expect(isPrimaryWindowForRecovery({ mainWindow: true, windowType: 'default' })).toBe(true);
    expect(isPrimaryWindowForRecovery({ mainWindow: false, windowType: 'onboarding' })).toBe(true);
    expect(isPrimaryWindowForRecovery({ mainWindow: false, windowType: 'composer' })).toBe(false);
  });

  it('recovers only when the Windows main renderer crashes before loading', () => {
    expect(
      shouldRecoverFromEarlyRendererCrash({
        platform: 'win32',
        primaryWindow: true,
        loaded: false,
        reason: 'crashed',
      })
    ).toBe(true);
    expect(
      shouldRecoverFromEarlyRendererCrash({
        platform: 'win32',
        primaryWindow: true,
        loaded: true,
        reason: 'crashed',
      })
    ).toBe(false);
    expect(
      shouldRecoverFromEarlyRendererCrash({
        platform: 'linux',
        primaryWindow: true,
        loaded: false,
        reason: 'crashed',
      })
    ).toBe(false);
  });

  it('persists recovery and relaunches once', () => {
    const app = {
      exit: jasmine.createSpy('exit'),
      relaunch: jasmine.createSpy('relaunch'),
    };
    const fileSystem = { writeFileSync: jasmine.createSpy('writeFileSync') };
    const options = {
      app,
      configDirPath: 'C:\\profile',
      loaded: false,
      primaryWindow: true,
      platform: 'win32',
      reason: 'crashed',
      fileSystem,
    };

    expect(attemptEarlyRendererCrashRecovery(options)).toBe(true);
    expect(fileSystem.writeFileSync).toHaveBeenCalled();
    expect(app.relaunch).toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(attemptEarlyRendererCrashRecovery(options)).toBe(false);
  });

  it('disables acceleration and clears Chromium caches when the marker exists', () => {
    const app = { disableHardwareAcceleration: jasmine.createSpy('disableHardwareAcceleration') };
    const fileSystem = {
      existsSync: jasmine
        .createSpy('existsSync')
        .andCallFake((filePath) => filePath === markerPath('C:\\profile')),
      rmSync: jasmine.createSpy('rmSync'),
      writeFileSync: jasmine.createSpy('writeFileSync'),
    };

    expect(preparePersistentSoftwareRendering(app, 'C:\\profile', 'win32', fileSystem)).toBe(true);
    expect(fileSystem.existsSync).toHaveBeenCalledWith(markerPath('C:\\profile'));
    expect(app.disableHardwareAcceleration).toHaveBeenCalled();
    expect(fileSystem.rmSync.callCount).toBe(3);
    expect(fileSystem.writeFileSync).toHaveBeenCalled();
  });
});
