import { Thread, Message, ChangeFolderTask, Folder } from 'mailspring-exports';

describe('ChangeMailTask', function() {
  describe('toJSON', function() {
    const trash = new Folder({ id: 'trash', name: 'trash', role: 'trash', accountId: 'acc1' });

    it('removes empty threadIds when only messages are provided', function() {
      const msg = new Message({ id: 'msg1', accountId: 'acc1', folder: new Folder({ id: 'inbox' }) });
      const task = new ChangeFolderTask({ folder: trash, messages: [msg], source: 'Test' });
      const json = task.toJSON();
      expect(json.messageIds).toBeDefined();
      expect(json.threadIds).toBeUndefined();
    });

    it('removes empty messageIds when only threads are provided', function() {
      const thread = new Thread({ id: 'thread1', accountId: 'acc1', folders: [new Folder({ id: 'inbox' })] });
      const task = new ChangeFolderTask({ folder: trash, threads: [thread], source: 'Test' });
      const json = task.toJSON();
      expect(json.threadIds).toBeDefined();
      expect(json.messageIds).toBeUndefined();
    });

    it('keeps non-empty messageIds and threadIds when both are set', function() {
      const task = new ChangeFolderTask({ folder: trash, source: 'Test' });
      task.threadIds = ['thread1'];
      task.messageIds = ['msg1'];
      const json = task.toJSON();
      expect(json.threadIds).toEqual(['thread1']);
      expect(json.messageIds).toEqual(['msg1']);
    });

    it('preserves all other task fields in the JSON output', function() {
      const msg = new Message({ id: 'msg2', accountId: 'acc1', folder: new Folder({ id: 'inbox' }) });
      const task = new ChangeFolderTask({ folder: trash, messages: [msg], source: 'Test' });
      const json = task.toJSON();
      expect(json.__cls).toBe('ChangeFolderTask');
      expect(json.aid).toBe('acc1');
      expect(json.folder).toBeDefined();
    });
  });
});
