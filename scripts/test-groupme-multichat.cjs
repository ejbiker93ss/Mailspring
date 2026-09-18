const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const React = require('../app/node_modules/react');
const { renderToStaticMarkup } = require('../app/node_modules/react-dom/server');
const base = 'app/internal_packages/matrix-chat/lib/';
function load(file, dependencies) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(base + file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => {
    if (name === 'react') return React;
    if (!(name in dependencies)) throw Error('Unexpected dependency: ' + name);
    return dependencies[name];
  }, AppEnv: { config: { get: () => undefined, set: () => {} }, getCurrentWindow: () => ({ isFocused: () => true }) }, window: {}, console, setTimeout, clearTimeout });
  return exports;
}

async function main() {
  const Markdown = load('groupme-markdown.tsx', {}).default;
  const html = renderToStaticMarkup(React.createElement(Markdown, { text: '# Heading\n**bold** and *italic*\n- item\n1. first\n> quote\n```\n<script>alert(1)</script>\n```\n[bad](javascript:alert(1))\n[good](https://example.com)' }));
  for (const tag of ['h1', 'strong', 'em', 'ul', 'ol', 'blockquote', 'pre']) assert(html.includes('<' + tag), tag);
  assert(!html.includes('<script>'));
  assert(!html.includes('href="javascript:'));
  assert(html.includes('href="https://example.com"'));
  const offsets = [];
  renderToStaticMarkup(React.createElement(Markdown, { text: '# **Hi** @User', renderText: (text, offset) => { if (text.includes('@User')) offsets.push(offset + text.indexOf('@User')); return text; } }));
  assert.deepStrictEqual(offsets, [9]);

  const pending = new Map();
  const sent = [];
  const api = {
    groupmeMessages: (_token, chat) => new Promise(resolve => pending.set(chat.id, resolve)),
    groupmeSend: async (_token, chat, body) => sent.push({ id: chat.id, body }),
    buildGroupMeMentions: () => [],
    groupmeMarkRead: async () => {},
  };
  const storeModule = load('groupme-store.ts', {
    'summermail-store': class { trigger() {} },
    'summermail-exports': { KeyManager: { getPassword: async () => null }, localized: s => s, WorkspaceStore: { rootSheet: () => ({ id: 'Other' }) } },
    './groupme-client': api,
  });
  const Store = storeModule.GroupMeChatStoreClass;
  Store.prototype.restore = async () => {};
  const store = new Store();
  store._token = 'test-only'; store._user = { id: 'self' };
  store._chats = ['a', 'b'].map(id => ({ id, kind: 'group', members: [], unreadCount: 0 }));
  store.selectChat('group:a');
  store.setComposerDraft('draft A', 'group:a');
  store.selectChat('group:b');
  store.setComposerDraft('draft B', 'group:b');
  pending.get('b')([{ id: 'b1' }]);
  pending.get('a')([{ id: 'a1' }]);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(store.timeline('group:a')[0].id, 'a1');
  assert.equal(store.timeline('group:b')[0].id, 'b1');
  assert.equal(store.composerDraft('group:a'), 'draft A');
  assert.equal(store.composerDraft('group:b'), 'draft B');
  store.refreshChats = async () => {};
  const send = store.sendMessage('group:a');
  await new Promise(r => setTimeout(r, 0));
  pending.get('a')([]);
  await send;
  assert.deepStrictEqual(sent, [{ id: 'a', body: 'draft A' }]);
  assert.equal(store.composerDraft('group:b'), 'draft B');
  const layout = load('chat-multichat.tsx', {});
  assert.equal(layout.chatPaneCount(839), 1);
  assert.equal(layout.chatPaneCount(840), 2);
  assert.equal(layout.chatPaneCount(1260), 3);
  assert.equal(layout.chatPaneCount(2200), 4);
  assert.equal(JSON.stringify(layout.recentChats(['b','a','c'], 'a')), '["a","b","c"]');
  const matrixModule = load('matrix-chat-store.ts', {
    'summermail-store': class { trigger() {} },
    'summermail-exports': { localized: s => s },
    'matrix-js-sdk': { EventType: { RoomMessage: 'm.room.message', Reaction: 'm.reaction' }, MsgType: { Text: 'm.text' }, RelationType: { Annotation: 'm.annotation' } },
    'matrix-js-sdk/lib/crypto-api': {},
    './matrix-session': { formatLoginError: e => String(e) },
  });
  const matrix = new matrixModule.MatrixChatStoreClass();
  matrix._userId = 'self';
  const matrixSent = [];
  matrix._client = {
    getRoom: id => ({ roomId: id, getLiveTimeline: () => ({getEvents: () => []}), getJoinedMembers: () => [] }),
    sendTextMessage: async (id, body) => matrixSent.push({id, body}),
    sendEvent: async (id, type, content) => matrixSent.push({id, type, content}),
  };
  matrix._refreshRooms = () => {};
  matrix._selectedRoomId = 'room-b';
  matrix.setComposerDraft('Matrix A', 'room-a');
  matrix.setComposerDraft('Matrix B', 'room-b');
  matrix.setReplyTo({eventId:'reply-a'}, 'room-a');
  await matrix.sendMessage('room-a');
  assert.equal(matrixSent[0].id, 'room-a');
  assert.equal(matrixSent[0].content['m.relates_to']['m.in_reply_to'].event_id, 'reply-a');
  assert.equal(matrix.composerDraft('room-b'), 'Matrix B');
  assert.equal(matrix.replyTo('room-a'), null);
  await matrix.toggleReaction('event-a', 'heart', 'room-a');
  assert.equal(matrixSent[1].id, 'room-a');
  matrix._client.sendTextMessage = async () => { throw Error('offline'); };
  matrix.setComposerDraft('retry A', 'room-a');
  await matrix.sendMessage('room-a');
  assert.equal(matrix.composerDraft('room-a'), 'retry A');
  assert.equal(matrix.composerDraft('room-b'), 'Matrix B');
  console.log('PASS: Matrix drafts, replies, send targets, reactions, and failed-send restoration are room-scoped.');
  console.log('PASS: Markdown safety/formatting/offsets, pane widths/order, draft isolation, late responses, and send routing. No live messages sent.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
