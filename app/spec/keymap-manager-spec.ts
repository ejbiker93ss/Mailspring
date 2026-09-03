import path from 'path';
import KeymapManager from '../src/keymap-manager';

describe('KeymapManager', function () {
  it('lets a template replace bindings for commands it defines while inheriting the rest', function () {
    const resourcePath = AppEnv.getLoadSettings().resourcePath;
    const manager = new KeymapManager({ configDirPath: resourcePath, resourcePath });
    const baseKeymap = manager.loadKeymap(path.join(resourcePath, 'keymaps', 'base.json'));
    const outlookKeymap = manager.loadKeymap(
      path.join(resourcePath, 'keymaps', 'templates', 'Outlook.json'),
      { replaceExistingCommands: true }
    );

    expect(manager.getBindingsForCommand('application:quit')).toEqual(['alt+f4']);
    expect(manager.getBindingsForCommand('core:mark-as-read')).toEqual(['ctrl+q']);
    expect(manager.getBindingsForCommand('core:copy')).toEqual(['mod+c']);
    expect((manager as any)._commandsCache['ctrl+q']).toEqual(['core:mark-as-read']);
    expect((manager as any)._commandsCache['ctrl+u']).toEqual(['core:mark-as-unread']);

    outlookKeymap.dispose();
    expect(manager.getBindingsForCommand('application:quit')).toEqual(['mod+q']);
    baseKeymap.dispose();
  });
});
