import { completeAccountSetup } from '../../../src/browser/complete-account-setup';

describe('account setup completion', () => {
  const windowKeys = { main: 'default', onboarding: 'onboarding' };

  const buildWindowManager = () => {
    const mainWindow = {
      focus: jasmine.createSpy('focus'),
      show: jasmine.createSpy('show'),
      waitForLoad: jasmine.createSpy('waitForLoad'),
    };
    const onboarding = { close: jasmine.createSpy('close') };
    const windowManager = {
      ensureWindow: jasmine.createSpy('ensureWindow'),
      get: jasmine
        .createSpy('get')
        .andCallFake((key) => (key === windowKeys.main ? mainWindow : onboarding)),
    };
    return { windowManager, mainWindow, onboarding };
  };

  it('presents the main window before closing onboarding on Windows', () => {
    const { windowManager, mainWindow, onboarding } = buildWindowManager();

    completeAccountSetup(windowManager, windowKeys, 'win32');

    expect(windowManager.ensureWindow).toHaveBeenCalledWith(windowKeys.main);
    expect(mainWindow.show).toHaveBeenCalled();
    expect(mainWindow.focus).toHaveBeenCalled();
    expect(onboarding.close).toHaveBeenCalled();
    expect(mainWindow.waitForLoad).not.toHaveBeenCalled();
  });

  it('retains the delayed main-window handoff on Linux', () => {
    const { windowManager, mainWindow, onboarding } = buildWindowManager();

    completeAccountSetup(windowManager, windowKeys, 'linux');

    expect(mainWindow.show).not.toHaveBeenCalled();
    expect(mainWindow.focus).not.toHaveBeenCalled();
    expect(onboarding.close).not.toHaveBeenCalled();
    expect(mainWindow.waitForLoad).toHaveBeenCalled();
    (mainWindow.waitForLoad as jasmine.Spy).mostRecentCall.args[0]();
    expect(onboarding.close).toHaveBeenCalled();
  });

  it('keeps onboarding open if the main window could not be created', () => {
    const { windowManager, onboarding } = buildWindowManager();
    (windowManager.get as jasmine.Spy).andCallFake((key) =>
      key === windowKeys.main ? null : onboarding
    );

    completeAccountSetup(windowManager, windowKeys, 'win32');

    expect(onboarding.close).not.toHaveBeenCalled();
  });
});
