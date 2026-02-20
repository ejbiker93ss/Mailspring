import React from 'react';
import ReactTestUtils from 'react-dom/test-utils';
import {
  Thread,
  Message,
  Folder,
  Actions,
  TaskQueue,
  CategoryStore,
  ChangeFolderTask,
} from 'mailspring-exports';

import MessageControls from '../lib/message-controls';

describe('MessageControls', function() {
  beforeEach(function() {
    this.trash = new Folder({ id: 'trash-id', name: 'trash', role: 'trash', accountId: TEST_ACCOUNT_ID });
    this.inbox = new Folder({ id: 'inbox-id', name: 'inbox', role: 'inbox', accountId: TEST_ACCOUNT_ID });
    this.testThread = new Thread({ id: 'thread-1', accountId: TEST_ACCOUNT_ID });
    this.message = new Message({
      id: 'msg-1',
      accountId: TEST_ACCOUNT_ID,
      threadId: 'thread-1',
      folder: this.inbox,
    });
  });

  describe('_renderTrashAction', function() {
    it('returns null when there is no trash category', function() {
      spyOn(CategoryStore, 'getTrashCategory').andReturn(null);
      const component = ReactTestUtils.renderIntoDocument(
        <MessageControls thread={this.testThread} message={this.message} />
      );
      const result = component._renderTrashAction();
      expect(result).toBeNull();
    });

    it('returns null when the message is already in the trash', function() {
      const messageInTrash = new Message({
        id: 'msg-2',
        accountId: TEST_ACCOUNT_ID,
        threadId: 'thread-1',
        folder: this.trash,
      });
      spyOn(CategoryStore, 'getTrashCategory').andReturn(this.trash);
      const component = ReactTestUtils.renderIntoDocument(
        <MessageControls thread={this.testThread} message={messageInTrash} />
      );
      const result = component._renderTrashAction();
      expect(result).toBeNull();
    });

    it('renders a trash button when the message is not in the trash', function() {
      spyOn(CategoryStore, 'getTrashCategory').andReturn(this.trash);
      const component = ReactTestUtils.renderIntoDocument(
        <MessageControls thread={this.testThread} message={this.message} />
      );
      const result = component._renderTrashAction();
      expect(result).not.toBeNull();
    });
  });

  describe('_onMoveMessageToTrash', function() {
    it('queues a ChangeFolderTask to move the message to trash', async function() {
      spyOn(CategoryStore, 'getTrashCategory').andReturn(this.trash);
      spyOn(Actions, 'queueTask');
      spyOn(TaskQueue, 'waitForPerformLocal').andReturn(Promise.resolve());
      spyOn(AppEnv.mailsyncBridge, 'sendSyncMailNow');

      const component = ReactTestUtils.renderIntoDocument(
        <MessageControls thread={this.testThread} message={this.message} />
      );
      await component._onMoveMessageToTrash();

      expect(Actions.queueTask).toHaveBeenCalled();
      const task = Actions.queueTask.mostRecentCall.args[0];
      expect(task instanceof ChangeFolderTask).toBe(true);
    });

    it('does nothing when there is no trash category', async function() {
      spyOn(CategoryStore, 'getTrashCategory').andReturn(null);
      spyOn(Actions, 'queueTask');

      const component = ReactTestUtils.renderIntoDocument(
        <MessageControls thread={this.testThread} message={this.message} />
      );
      await component._onMoveMessageToTrash();

      expect(Actions.queueTask).not.toHaveBeenCalled();
    });

    it('does nothing when the message is already in the trash', async function() {
      const messageInTrash = new Message({
        id: 'msg-3',
        accountId: TEST_ACCOUNT_ID,
        threadId: 'thread-1',
        folder: this.trash,
      });
      spyOn(CategoryStore, 'getTrashCategory').andReturn(this.trash);
      spyOn(Actions, 'queueTask');

      const component = ReactTestUtils.renderIntoDocument(
        <MessageControls thread={this.testThread} message={messageInTrash} />
      );
      await component._onMoveMessageToTrash();

      expect(Actions.queueTask).not.toHaveBeenCalled();
    });

    it('calls sendSyncMailNow after the task is performed locally', async function() {
      spyOn(CategoryStore, 'getTrashCategory').andReturn(this.trash);
      spyOn(Actions, 'queueTask');
      spyOn(TaskQueue, 'waitForPerformLocal').andReturn(Promise.resolve());
      spyOn(AppEnv.mailsyncBridge, 'sendSyncMailNow');

      const component = ReactTestUtils.renderIntoDocument(
        <MessageControls thread={this.testThread} message={this.message} />
      );
      await component._onMoveMessageToTrash();

      expect(AppEnv.mailsyncBridge.sendSyncMailNow).toHaveBeenCalled();
    });
  });
});
