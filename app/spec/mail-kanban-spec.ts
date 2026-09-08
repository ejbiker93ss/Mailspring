import { AccountStore, Actions, ChangeFolderTask, Folder, Thread } from 'summermail-exports';
import MailKanban from '../internal_packages/mail-kanban/lib/mail-kanban';

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
});
