import { completeAccountSetup } from '../../../src/browser/complete-account-setup';

describe('account setup completion', () => {
  const windowKeys = { main: 'default', onboarding: 'onboarding' };

  const buildWindowManager = () => {
    const mainWindow = { waitForLoad: jasmine.createSpy('waitForLoad') };
    const onboarding = { close: jasmine.createSpy('close') };
    const windowManager = {
      ensureWindow: jasmine.createSpy('ensureWindow'),
      get: jasmine
        .createSpy('get')
        .andCallFake((key) => (key === windowKeys.main ? mainWindow : onboarding)),
    };
    return { windowManager, mainWindow, onboarding };
  };

  it('closes onboarding immediately on Windows', () => {
    const { windowManager, mainWindow, onboarding } = buildWindowManager();

    completeAccountSetup(windowManager, windowKeys, 'win32');

    expect(windowManager.ensureWindow).toHaveBeenCalledWith(windowKeys.main);
    expect(onboarding.close).toHaveBeenCalled();
    expect(mainWindow.waitForLoad).not.toHaveBeenCalled();
  });

  it('retains the delayed main-window handoff on Linux', () => {
    const { windowManager, mainWindow, onboarding } = buildWindowManager();

    completeAccountSetup(windowManager, windowKeys, 'linux');

    expect(onboarding.close).not.toHaveBeenCalled();
    expect(mainWindow.waitForLoad).toHaveBeenCalled();
    (mainWindow.waitForLoad as jasmine.Spy).mostRecentCall.args[0]();
    expect(onboarding.close).toHaveBeenCalled();
  });
});
