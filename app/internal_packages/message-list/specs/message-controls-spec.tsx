import { Actions, Contact, Folder, Message, Thread } from 'mailspring-exports';

import MessageControls from '../lib/message-controls';

describe('MessageControls', function () {
  const thread = new Thread({ id: 'thread-1', accountId: 'account-1' });

  const messageInFolder = (role: string) =>
    new Message({
      id: `message-${role}`,
      accountId: 'account-1',
      threadId: thread.id,
      from: [new Contact({ email: 'sender@example.com' })],
      folder: new Folder({ id: `folder-${role}`, accountId: 'account-1', role }),
    });

  it('offers Send Again for sent messages and opens a duplicate in a popout composer', function () {
    const message = messageInFolder('sent');
    const controls = new MessageControls({ thread, message });
    const sendAgain = controls._items().find((item) => item.name === 'Send Again');
    spyOn(Actions, 'composeSendAgain');

    expect(sendAgain).toBeDefined();
    sendAgain.select();
    expect(Actions.composeSendAgain).toHaveBeenCalledWith({
      threadId: thread.id,
      messageId: message.id,
    });
  });

  it('does not offer Send Again for received messages', function () {
    const controls = new MessageControls({ thread, message: messageInFolder('inbox') });

    expect(controls._items().some((item) => item.name === 'Send Again')).toBe(false);
  });
});
