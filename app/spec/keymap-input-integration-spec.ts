import path from 'path';

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.originalSetTimeout(resolve, milliseconds));

describe('Keymap input integration', function () {
  it('turns physical Ctrl+Q and Ctrl+U keypresses into read-state commands', async function () {
    const resourcePath = AppEnv.getLoadSettings().resourcePath;
    const outlookKeymap = AppEnv.keymaps.loadKeymap(
      path.join(resourcePath, 'keymaps', 'templates', 'Outlook.json'),
      { replaceExistingCommands: true }
    );
    const receivedCommands: string[] = [];
    const receivedKeydowns: Array<{ key: string; code: string; ctrlKey: boolean }> = [];
    const stoppedCombinations: Array<{ combo: string; stopped: boolean; target: string }> = [];
    const Mousetrap = require('mousetrap');
    const originalStopCallback = Mousetrap.prototype.stopCallback;
    Mousetrap.prototype.stopCallback = function (event, element, combo) {
      const stopped = originalStopCallback.call(this, event, element, combo);
      stoppedCombinations.push({ combo, stopped, target: element.tagName });
      return stopped;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      receivedKeydowns.push({ key: event.key, code: event.code, ctrlKey: event.ctrlKey });
    };
    window.addEventListener('keydown', onKeyDown, true);
    const commandHandlers = AppEnv.commands.add(document.body, {
      'core:mark-as-read': () => receivedCommands.push('core:mark-as-read'),
      'core:mark-as-unread': () => receivedCommands.push('core:mark-as-unread'),
    });

    try {
      // Menu and command updates are coalesced through animation frames.
      await wait(250);
      const webContents = AppEnv.getCurrentWindow().webContents;

      require('mousetrap').trigger('ctrl+q');
      require('mousetrap').trigger('ctrl+u');
      expect(receivedCommands).toEqual(['core:mark-as-read', 'core:mark-as-unread']);
      receivedCommands.length = 0;

      webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Q', modifiers: ['control'] });
      webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Q', modifiers: ['control'] });
      webContents.sendInputEvent({ type: 'keyDown', keyCode: 'U', modifiers: ['control'] });
      webContents.sendInputEvent({ type: 'keyUp', keyCode: 'U', modifiers: ['control'] });
      await wait(100);

      expect(receivedKeydowns).toEqual([
        { key: 'q', code: 'KeyQ', ctrlKey: true },
        { key: 'u', code: 'KeyU', ctrlKey: true },
      ]);
      expect(stoppedCombinations).toEqual([
        { combo: 'ctrl+q', stopped: false, target: 'BODY' },
        { combo: 'ctrl+u', stopped: false, target: 'BODY' },
      ]);
      expect(receivedCommands).toContain('core:mark-as-read');
      expect(receivedCommands).toContain('core:mark-as-unread');
    } finally {
      Mousetrap.prototype.stopCallback = originalStopCallback;
      window.removeEventListener('keydown', onKeyDown, true);
      commandHandlers.dispose();
      outlookKeymap.dispose();
    }
  });
});
