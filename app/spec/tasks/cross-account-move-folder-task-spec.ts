import { CrossAccountMoveFolderTask, Folder, Thread } from 'mailspring-exports';

describe('CrossAccountMoveFolderTask', () => {
  const source = new Thread({ id: 'thread-1', accountId: 'source' });
  const destination = new Folder({ id: 'folder-1', accountId: 'target', path: 'INBOX' });

  it('routes prepare and import phases to the correct account', () => {
    const prepare = new CrossAccountMoveFolderTask({
      phase: 'prepare',
      threads: [source],
      targetAccountId: 'target',
      targetFolder: destination,
      stagingDirectory: 'C:\\staging',
    });
    expect(prepare.accountId).toBe('source');
    expect(prepare.threadIds).toEqual(['thread-1']);
    expect(() => prepare.willBeQueued()).not.toThrow();

    const imported = new CrossAccountMoveFolderTask({
      phase: 'import',
      transferId: prepare.transferId,
      sourceAccountId: 'source',
      targetAccountId: 'target',
      targetFolder: destination,
      stagingDirectory: 'C:\\staging',
      files: [
        {
          filepath: 'C:\\staging\\message.eml',
          messageId: 'message-1',
          headerMessageId: 'message-1@example.com',
          date: 1,
          unread: false,
          starred: true,
        },
      ],
    });
    expect(imported.accountId).toBe('target');
    expect(() => imported.willBeQueued()).not.toThrow();
  });

  it('rejects same-account and empty imports', () => {
    const sameAccount = new CrossAccountMoveFolderTask({
      phase: 'prepare',
      threads: [source],
      targetAccountId: 'source',
      targetFolder: new Folder({ id: 'same', accountId: 'source', path: 'INBOX' }),
      stagingDirectory: 'C:\\staging',
    });
    expect(() => sameAccount.willBeQueued()).toThrow();

    const emptyImport = new CrossAccountMoveFolderTask({
      phase: 'import',
      sourceAccountId: 'source',
      targetAccountId: 'target',
      targetFolder: destination,
      stagingDirectory: 'C:\\staging',
      files: [],
    });
    expect(() => emptyImport.willBeQueued()).toThrow();
  });

  it('inflates legacy completed records without treating them as active transfers', () => {
    const legacy = new CrossAccountMoveFolderTask().fromJSON({
      __cls: 'CrossAccountMoveFolderTask',
      id: 'legacy-task',
      aid: 'target',
      status: 'complete',
      targetAccountId: 'target',
      targetFolder: destination.toJSON(),
      threads: [source.toJSON()],
    });
    expect(legacy.phase).toBe(undefined);
    expect(legacy.transferId).toBe(undefined);
  });
});
