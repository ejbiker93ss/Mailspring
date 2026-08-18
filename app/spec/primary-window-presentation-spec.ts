import Application from '../src/browser/application';
import { getMenuTemplate } from '../src/browser/system-tray-manager';

describe('Windows primary window presentation', () => {
  it('puts an explicit open action in the Windows tray menu', () => {
    const application = { emit: jasmine.createSpy('emit') } as any;
    const template = getMenuTemplate('win32', application) as any[];

    expect(template[0].label).toContain('Open');
    template[0].click();
    expect(application.emit).toHaveBeenCalledWith('application:show-main-window');
  });

  it('shows and focuses onboarding when no account exists', () => {
    const primary = {
      focus: jasmine.createSpy('focus'),
      isMinimized: jasmine.createSpy('isMinimized').andReturn(false),
      show: jasmine.createSpy('show'),
    };
    const application = new Application();
    application.config = { get: jasmine.createSpy('get').andReturn([]) } as any;
    application.windowManager = {
      ensureWindow: jasmine.createSpy('ensureWindow'),
      get: jasmine.createSpy('get').andReturn(primary),
    } as any;

    application.presentPrimaryWindow();

    const ensureArgs = (application.windowManager.ensureWindow as jasmine.Spy).mostRecentCall.args;
    expect(ensureArgs[0]).toBe('onboarding');
    expect(ensureArgs[1].title).toBe('Welcome to Mailspring');
    expect(application.windowManager.get).toHaveBeenCalledWith('onboarding');
    expect(primary.show).toHaveBeenCalled();
    expect(primary.focus).toHaveBeenCalled();
  });

  it('restores and presents the main window when an account exists', () => {
    const primary = {
      focus: jasmine.createSpy('focus'),
      isMinimized: jasmine.createSpy('isMinimized').andReturn(true),
      restore: jasmine.createSpy('restore'),
      show: jasmine.createSpy('show'),
    };
    const application = new Application();
    application.config = { get: jasmine.createSpy('get').andReturn([{}]) } as any;
    application.windowManager = {
      ensureWindow: jasmine.createSpy('ensureWindow'),
      get: jasmine.createSpy('get').andReturn(primary),
    } as any;

    application.presentPrimaryWindow();

    expect(application.windowManager.get).toHaveBeenCalledWith('default');
    expect(primary.restore).toHaveBeenCalled();
    expect(primary.show).toHaveBeenCalled();
    expect(primary.focus).toHaveBeenCalled();
  });
});
