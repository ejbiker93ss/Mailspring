const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(
  path.join(__dirname, '../app/internal_packages/matrix-chat/lib/groupme-client.ts'),
  'utf8'
);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
let responses = [];
const calls = [];
const context = {
  exports: {},
  fetch: async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    assert.ok(responses.length, 'unexpected network request');
    const [status, body] = responses.shift();
    return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) };
  },
};
vm.runInNewContext(output, context);
const api = context.exports;

(async () => {
  const emojiAttachment = {
    type: 'emoji',
    placeholder: '�',
    charmap: [
      [18, 6],
      [1, 0],
    ],
  };
  const emojiMessage = api.mapGroupMeMessage(
    { id: 'custom', text: 'Hi � then �', attachments: [emojiAttachment] },
    'group'
  );
  assert.deepEqual(JSON.parse(JSON.stringify(emojiMessage.customEmoji)), [
    { start: 3, length: 1, packId: 18, index: 6 },
    { start: 10, length: 1, packId: 1, index: 0 },
  ]);
  assert.equal(api.mapGroupMeCustomEmoji('ordinary 👍 emoji', [emojiAttachment]).length, 0);
  assert.equal(
    api.mapGroupMeCustomEmoji('�', [{ ...emojiAttachment, charmap: [[-1, 6]] }]).length,
    0
  );
  assert.equal(api.mapGroupMeCustomEmoji('�', [emojiAttachment]).length, 1);
  const unreadChat = api.mapGroupMeDirect(
    {
      other_user: { id: '22', name: 'Test' },
      last_message: { id: '178914206300214133', sender_id: '22' },
      unread_count: null,
    },
    '11'
  );
  assert.equal(api.groupmeUnreadAfterReceipt(unreadChat, null, '11'), 0);
  assert.equal(api.groupmeUnreadAfterReceipt(unreadChat, undefined, '11'), 0);
  assert.equal(api.groupmeUnreadAfterReceipt(unreadChat, '178914206300214132', '11'), 0);
  assert.equal(api.groupmeUnreadAfterReceipt(unreadChat, '168571787861409105', '11'), 0);
  assert.equal(api.groupmeUnreadAfterReceipt(unreadChat, '168571787861409105', '11', 1), 1);
  assert.equal(api.groupmeUnreadAfterReceipt(unreadChat, '178914206300214133', '11', 1), 0);
  assert.equal(
    api.groupmeUnreadAfterReceipt({ ...unreadChat, unreadStateKnown: true }, null, '11', 1),
    0
  );
  assert.equal(api.groupmeUnreadAfterReceipt(unreadChat, '178914206300214133', '11'), 0);
  assert.equal(api.groupmeUnreadAfterReceipt(unreadChat, '178914206300214134', '11'), 0);
  assert.equal(api.groupmeUnreadAfterReceipt(unreadChat, '178914206300214132', '22'), 0);
  assert.equal(api.groupmeUnreadAfterReceipt({ ...unreadChat, unreadCount: 3 }, null, '11'), 3);
  for (const wrapped of [false, true]) {
    const challenge = { verification: { code: 'challenge-id', methods: { sms: '43' } } };
    responses = [
      [202, wrapped ? { response: challenge, meta: { code: 202 } } : challenge],
      [200, { response: { hint: '43' } }],
      [200, { status: 20000 }],
      [200, { response: { access_token: 'test-token', user_id: '9' } }],
    ];
    const login = await api.groupmeLogin('test@example.com', 'test-password', 'test-device');
    assert.equal(login.mfa.code, 'challenge-id');
    assert.equal(await api.groupmeInitiateSms(login.mfa.code), '43');
    assert.equal(
      calls.at(-1).url,
      'https://api.groupme.com/v3/verifications/challenge-id/initiate'
    );
    await api.groupmeConfirmPin(login.mfa.code, '1234');
    const result = await api.groupmeLogin(
      'test@example.com',
      'test-password',
      'test-device',
      login.mfa.code
    );
    assert.equal(result.token, 'test-token');
  }
  responses = [[202, { response: {} }]];
  await assert.rejects(
    api.groupmeLogin('test@example.com', 'test-password', 'device'),
    /valid verification ID/
  );
  const before = calls.length;
  await assert.rejects(api.groupmeInitiateSms('undefined'), /sign in again/);
  assert.equal(calls.length, before);
  responses = [[200, { meta: { errors: ['not acceptable verification'] } }]];
  await assert.rejects(api.groupmeInitiateSms('challenge-id'), /not acceptable verification/);
  responses = [[400, { meta: { errors: ['delivery rejected'] } }]];
  await assert.rejects(api.groupmeInitiateSms('challenge-id'), /delivery rejected/);
  responses = [[200, { response: { reactions: [{ type: 'unicode', code: '🔥' }] } }]];
  await api.groupmeSetReaction('test-token', '11+22', 'message-id', '🔥');
  assert.equal(
    calls.at(-1).url,
    'https://api.groupme.com/v3/messages/11%2B22/message-id/like?token=test-token'
  );
  assert.deepEqual(calls.at(-1).body, { like_icon: { type: 'unicode', code: '🔥' } });
  responses = [[200, {}]];
  await api.groupmeSetReaction('test-token', '11+22', 'message-id', null);
  assert.equal(
    calls.at(-1).url,
    'https://api.groupme.com/v3/messages/11%2B22/message-id/unlike?token=test-token'
  );
  responses = [[200, { response: { read_receipt: { message_id: 'message-id' } } }]];
  await api.groupmeMarkRead(
    'test-token',
    {
      conversationId: '11+22',
      id: '22',
      kind: 'direct',
    },
    'message-id'
  );
  assert.equal(calls.at(-1).url, 'https://v2.groupme.com/read_receipts');
  assert.deepEqual(calls.at(-1).body, {
    read_receipt: { chat_id: '11+22', message_id: 'message-id' },
  });
  responses = [[201, { response: { message: { id: 'sent-message' } } }]];
  const sentId = await api.groupmeSend(
    'test-token',
    {
      conversationId: 'group-id',
      id: 'group-id',
      kind: 'group',
      lastMessage: '',
      lastMessageAt: 0,
      lastMessageId: null,
      members: [],
      name: 'Test group',
      unreadCount: 0,
    },
    'Hi @Alan',
    {
      replyToId: 'original-message',
      mentions: [{ userId: '9', start: 3, length: 5 }],
    }
  );
  assert.equal(sentId, 'sent-message');
  assert.deepEqual(calls.at(-1).body.message.attachments, [
    {
      type: 'reply',
      reply_id: 'original-message',
      base_reply_id: 'original-message',
    },
    { type: 'mentions', user_ids: ['9'], loci: [[3, 5]] },
  ]);
  console.log('PASS GroupMe auth, reactions, replies, mentions, and read receipts');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
