import ApplicationMenu from '../src/browser/application-menu';

describe('ApplicationMenu', function () {
  describe('translateTemplate', function () {
    it('registers contextual command accelerators with the native application menu', function () {
      const applicationMenu = Object.create(ApplicationMenu.prototype) as ApplicationMenu;
      const template: any[] = [
        { label: 'Mark as Read', command: 'core:mark-as-read' },
        { label: 'Mark as Unread', command: 'core:mark-as-unread' },
        { label: 'Quit', command: 'application:quit' },
      ];

      applicationMenu.translateTemplate(template, {
        'core:mark-as-read': ['ctrl+q'],
        'core:mark-as-unread': ['ctrl+u'],
        'application:quit': ['alt+f4'],
      });

      expect(template[0].accelerator).toBe('Ctrl+Q');
      expect(template[0].registerAccelerator).toBeUndefined();
      expect(template[1].accelerator).toBe('Ctrl+U');
      expect(template[1].registerAccelerator).toBeUndefined();
      expect(template[2].accelerator).toBe('Alt+F4');
      expect(template[2].registerAccelerator).toBeUndefined();
    });
  });
});
