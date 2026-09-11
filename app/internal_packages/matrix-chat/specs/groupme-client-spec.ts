import {
  buildGroupMeMentions,
  mapGroupMeDirect,
  mapGroupMeGroup,
  mapGroupMeMessage,
} from '../lib/groupme-client';

describe('GroupMe unofficial client mapping', () => {
  it('keeps group identity, preview, and members', () => {
    const chat = mapGroupMeGroup({
      id: '111',
      name: 'Family',
      updated_at: 1700000000,
      unread_count: 2,
      members: [{ user_id: '9', nickname: 'Jane' }],
      messages: {
        last_message_created_at: 1700000001,
        preview: { text: 'Hello world' },
      },
    });
    expect(chat).toEqual({
      conversationId: '111',
      id: '111',
      kind: 'group',
      lastMessage: 'Hello world',
      lastMessageAt: 1700000001000,
      lastMessageId: null,
      lastMessageSenderId: null,
      members: [{ id: '9', name: 'Jane' }],
      name: 'Family',
      unreadCount: 2,
    });
  });

  it('maps a DM to the other user and compound conversation id', () => {
    const chat = mapGroupMeDirect(
      {
        updated_at: 1700000100,
        other_user: { id: '22', name: 'Bob' },
        last_message: {
          conversation_id: '11+22',
          created_at: 1700000100,
          text: 'On my way',
        },
      },
      '11'
    );
    expect(chat.id).toBe('22');
    expect(chat.kind).toBe('direct');
    expect(chat.conversationId).toBe('11+22');
    expect(chat.lastMessage).toBe('On my way');
  });

  it('uses GroupMe server read state without inventing local unread chats', () => {
    const read = mapGroupMeDirect(
      {
        unread_count: null,
        last_read_message_id: 'm2',
        other_user: { id: '22', name: 'Bob' },
        last_message: { id: 'm2', conversation_id: '11+22', text: 'Read' },
      },
      '11'
    );
    const unread = mapGroupMeDirect(
      {
        unread_count: null,
        last_read_message_id: 'm1',
        other_user: { id: '22', name: 'Bob' },
        last_message: { id: 'm2', conversation_id: '11+22', text: 'New' },
      },
      '11'
    );
    expect(read.unreadCount).toBe(0);
    expect(unread.unreadCount).toBe(1);
  });

  it('keeps image-only messages instead of dropping them', () => {
    const message = mapGroupMeMessage(
      {
        id: 'm1',
        created_at: 1700000200,
        sender_id: '9',
        name: 'Jane',
        text: null,
        favorited_by: ['9'],
        attachments: [{ type: 'image', url: 'https://i.groupme.com/pic.jpeg' }],
      },
      '111',
      '9'
    );
    expect(message?.imageUrl).toBe('https://i.groupme.com/pic.jpeg');
    expect(message?.likedByMe).toBe(true);
    expect(message?.reactions).toEqual([{ count: 1, emoji: '❤️', likedByMe: true }]);
    expect(message?.text).toBe('Image');
  });

  it('uses the message conversation id and maps v7 emoji reactions', () => {
    const message = mapGroupMeMessage(
      {
        id: 'm2',
        conversation_id: '11+22',
        created_at: 1700000200,
        sender_id: '22',
        name: 'Bob',
        text: 'Great',
        favorited_by: ['9', '10'],
        reactions: [
          { type: 'unicode', code: '🔥' },
          { type: 'unicode', code: '👍' },
        ],
      },
      'incorrect-fallback',
      '10'
    );
    expect(message?.conversationId).toBe('11+22');
    expect(message?.reactions).toEqual([
      { count: 1, emoji: '🔥', likedByMe: false },
      { count: 1, emoji: '👍', likedByMe: true },
    ]);
  });

  it('maps reply and mention attachments', () => {
    const message = mapGroupMeMessage(
      {
        id: 'm3',
        text: 'Hi @Alan Smith',
        attachments: [
          { type: 'reply', reply_id: 'm1', base_reply_id: 'm1' },
          { type: 'mentions', user_ids: ['9'], loci: [[3, 11]] },
        ],
      },
      '111'
    );
    expect(message?.replyToId).toBe('m1');
    expect(message?.mentions).toEqual([{ userId: '9', start: 3, length: 11 }]);
  });

  it('builds exact non-overlapping mention ranges for member names', () => {
    expect(
      buildGroupMeMentions('Hi @Alan Smith and @Earl!', [
        { id: '1', name: 'Alan' },
        { id: '2', name: 'Alan Smith' },
        { id: '3', name: 'Earl' },
      ])
    ).toEqual([
      { userId: '2', start: 3, length: 11 },
      { userId: '3', start: 19, length: 5 },
    ]);
  });
});
