import { CanvasUtils } from 'summermail-exports';
import { beginUnthreadedItemDrag, dragDataForUnthreadedItem } from '../lib/unthreaded-thread-list';

describe('unthreaded message dragging', () => {
  const item = {
    thread: { id: 'thread-1', accountId: 'account-1' },
    message: { id: 'message-1', folder: { id: 'folder-1' } },
  };

  it('builds the standard thread drag payload with message context', () => {
    expect(dragDataForUnthreadedItem(item)).toEqual({
      threadIds: ['thread-1'],
      messageIds: ['message-1'],
      accountIds: ['account-1'],
      sourceFolderId: 'folder-1',
    });
  });

  it('writes the payload and account type consumed by folder and Kanban drops', () => {
    const setData = jasmine.createSpy('setData');
    const setDragImage = jasmine.createSpy('setDragImage');
    const stopPropagation = jasmine.createSpy('stopPropagation');
    const canvas = document.createElement('canvas');
    spyOn(CanvasUtils, 'canvasForDragging').andReturn(canvas);
    const event = {
      stopPropagation,
      dataTransfer: {
        effectAllowed: 'none',
        dropEffect: 'none',
        setData,
        setDragImage,
      },
    };

    beginUnthreadedItemDrag(event, item);

    expect(event.dataTransfer.effectAllowed).toBe('move');
    expect(event.dataTransfer.dropEffect).toBe('move');
    expect(stopPropagation).toHaveBeenCalled();
    expect(setDragImage).toHaveBeenCalledWith(canvas, 10, 10);
    expect(setData).toHaveBeenCalledWith(
      'summermail-threads-data',
      JSON.stringify(dragDataForUnthreadedItem(item))
    );
    expect(setData).toHaveBeenCalledWith('summermail-accounts=account-1', '1');
  });
});
