import { Actions, ComponentRegistry } from 'summermail-exports';

describe('Composer dependency preload', () => {
  it('loads the editor in a spare window without activating a composer or creating a draft', async () => {
    spyOn(Actions, 'queueTask');
    spyOn(ComponentRegistry, 'register');
    // Do not send a window:loaded event from this isolated startup invocation.
    spyOn(window, 'requestAnimationFrame').andReturn(0);
    const activatePackages = jasmine.createSpy('activatePackages');
    const spareWindow = {
      getLoadSettings: () => ({ windowType: 'emptyWindow' }),
      themes: { loadStaticStylesheets: () => {} },
      initializeBasicSheet: () => {},
      initializeReactRoot: () => {},
      packages: { activatePackages },
    };

    await AppEnv.startWindow.call(spareWindow);

    const editorPath = require.resolve('../internal_packages/composer/lib/composer-view');
    expect(require.cache[editorPath]).toBeDefined();
    expect(activatePackages).toHaveBeenCalledWith('emptyWindow');
    expect(activatePackages.callCount).toBe(1);
    expect(ComponentRegistry.register).not.toHaveBeenCalled();
    expect(Actions.queueTask).not.toHaveBeenCalled();
  });
});
