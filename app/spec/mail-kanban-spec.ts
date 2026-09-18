import fs from 'fs';
import {
  Account,
  AccountStore,
  Actions,
  ChangeFolderTask,
  Folder,
  Thread,
} from 'summermail-exports';
import { CrossAccountMoveFolderTask } from '../src/flux/tasks/cross-account-move-folder-task';
import MailKanban, {
  ALL_ACCOUNTS_ID,
  suggestedCombinedLaneFolders,
} from '../internal_packages/mail-kanban/lib/mail-kanban';

describe('Mail Kanban folder drops', () => {
  let board: MailKanban;
  let queued: ChangeFolderTask[];
  const inbox = new Folder({ id: 'inbox', accountId: 'account', path: 'INBOX' });
  const complete = new Folder({ id: 'complete', accountId: 'account', path: 'Complete Tasks' });

  beforeEach(() => {
    spyOn(AccountStore, 'accounts').andReturn([]);
    queued = [];
    spyOn(Actions, 'queueTask').andCallFake((task) => queued.push(task));
    board = new MailKanban({});
    board.state = {
      ...board.state,
      accountId: 'account',
      folders: [inbox, complete],
    };
    spyOn(board, 'setState').andCallFake((state) => {
      board.state = { ...board.state, ...state };
    });
  });

  const dropFromInbox = () => {
    board._drop(
      {
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: {
          getData: (type) =>
            type === 'summermail-threads-data'
              ? JSON.stringify({ threadIds: ['thread'], sourceFolderId: inbox.id })
              : '',
        },
      } as React.DragEvent,
      complete
    );
  };

  it('moves an Inbox conversation even when older messages are already completed', () => {
    board.setState({
      threads: [new Thread({ id: 'thread', accountId: 'account', folders: [inbox, complete] })],
      draggingThreadId: 'thread',
      draggingSourceFolderId: inbox.id,
      dragOverLaneId: 'complete-lane',
    });
    dropFromInbox();
    expect(queued.length).toBe(1);
    expect(queued[0] instanceof ChangeFolderTask).toBe(true);
    expect(queued[0].threadIds).toEqual(['thread']);
    expect(queued[0].previousFolder.id).toBe(inbox.id);
    expect(queued[0].folder.id).toBe(complete.id);
    expect(board.state.draggingThreadId).toBe(null);
    expect(board.state.dragOverLaneId).toBe(null);
  });

  it('moves a conversation that is only in Inbox', () => {
    board.setState({
      threads: [new Thread({ id: 'thread', accountId: 'account', folders: [inbox] })],
    });
    dropFromInbox();
    expect(queued.length).toBe(1);
    expect(queued[0].folder.id).toBe(complete.id);
  });

  it('ignores a drop back into the source lane', () => {
    board.setState({
      threads: [new Thread({ id: 'thread', accountId: 'account', folders: [inbox, complete] })],
    });
    board._moveThread('thread', inbox, inbox);
    expect(queued.length).toBe(0);
  });

  it('ignores a conversation that is no longer on the board', () => {
    dropFromInbox();
    expect(queued.length).toBe(0);
  });

  describe('all-account boards', () => {
    const accountA = new Account({ id: 'account-a', emailAddress: 'a@example.com' });
    const accountB = new Account({ id: 'account-b', emailAddress: 'b@example.com' });
    const inboxA = new Folder({
      id: 'inbox-a',
      accountId: accountA.id,
      path: 'INBOX',
      role: 'inbox',
    });
    const doneA = new Folder({ id: 'done-a', accountId: accountA.id, path: 'Done' });
    const inboxB = new Folder({
      id: 'inbox-b',
      accountId: accountB.id,
      path: 'INBOX',
      role: 'inbox',
    });
    const doneB = new Folder({ id: 'done-b', accountId: accountB.id, path: 'Done' });

    it('suggests lanes from each account before adding completion lanes', () => {
      const suggested = suggestedCombinedLaneFolders(
        [accountA, accountB],
        [inboxA, doneA, inboxB, doneB]
      );
      expect(suggested.map((folder) => folder.id)).toEqual([
        inboxA.id,
        inboxB.id,
        doneA.id,
        doneB.id,
      ]);
    });

    it('uses the copy preference for cross-account drops', () => {
      const thread = new Thread({ id: 'cross-thread', accountId: accountA.id, folders: [inboxA] });
      board.state = {
        ...board.state,
        accountId: ALL_ACCOUNTS_ID,
        folders: [inboxA, doneB],
        threads: [thread],
      };
      spyOn(AppEnv.config, 'get').andCallFake((key) => {
        if (key === 'core.reading.crossAccountDragBehavior') return 'copy';
        return true;
      });
      spyOn(AppEnv, 'getConfigDirPath').andReturn('C:\\summermail-kanban-spec');
      spyOn(fs, 'mkdirSync').andReturn(undefined);

      board._moveThread(thread.id, inboxA, doneB);

      expect(queued.length).toBe(1);
      expect(queued[0] instanceof CrossAccountMoveFolderTask).toBe(true);
      const transfer = queued[0] as unknown as CrossAccountMoveFolderTask;
      expect(transfer.sourceAccountId).toBe(accountA.id);
      expect(transfer.targetAccountId).toBe(accountB.id);
      expect(transfer.targetFolder.id).toBe(doneB.id);
      expect(transfer.deleteFromSource).toBe(false);
    });

    it('uses the move preference for cross-account drops', () => {
      const thread = new Thread({ id: 'cross-thread', accountId: accountA.id, folders: [inboxA] });
      board.state = {
        ...board.state,
        accountId: ALL_ACCOUNTS_ID,
        folders: [inboxA, doneB],
        threads: [thread],
      };
      spyOn(AppEnv.config, 'get').andCallFake((key) => {
        if (key === 'core.reading.crossAccountDragBehavior') return 'move';
        return true;
      });
      spyOn(AppEnv, 'getConfigDirPath').andReturn('C:\\summermail-kanban-spec');
      spyOn(fs, 'mkdirSync').andReturn(undefined);

      board._moveThread(thread.id, inboxA, doneB);

      const transfer = queued[0] as unknown as CrossAccountMoveFolderTask;
      expect(transfer.deleteFromSource).toBe(true);
    });

    it('blocks cross-account drops when the setting is disabled', () => {
      const thread = new Thread({ id: 'cross-thread', accountId: accountA.id, folders: [inboxA] });
      board.state = {
        ...board.state,
        accountId: ALL_ACCOUNTS_ID,
        folders: [inboxA, doneB],
        threads: [thread],
      };
      spyOn(AppEnv.config, 'get').andReturn(false);

      board._moveThread(thread.id, inboxA, doneB);

      expect(queued.length).toBe(0);
    });
  });
});
