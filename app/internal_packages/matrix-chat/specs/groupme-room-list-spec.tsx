import React from 'react';
import ReactDOM from 'react-dom';
import ReactTestUtils from 'react-dom/test-utils';
import { GroupMeAvatar } from '../lib/groupme-room-list';
import { GroupMeChat } from '../lib/groupme-client';

describe('GroupMe room avatars', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  it('shows the GroupMe image and falls back to initials when loading fails', () => {
    const chat: GroupMeChat = {
      avatarUrl: 'https://i.groupme.com/family.jpeg',
      conversationId: '111',
      id: '111',
      kind: 'group',
      lastMessage: '',
      lastMessageAt: 0,
      lastMessageId: null,
      lastMessageSenderId: null,
      members: [],
      name: 'Family Plans',
      unreadCount: 0,
    };

    ReactDOM.render(<GroupMeAvatar chat={chat} />, container);
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe(chat.avatarUrl);
    if (!image) throw new Error('Expected the GroupMe avatar image to render.');

    ReactTestUtils.act(() => ReactTestUtils.Simulate.error(image));
    expect(container.querySelector('img')).toBe(null);
    expect(container.textContent).toBe('FP');
  });
});
