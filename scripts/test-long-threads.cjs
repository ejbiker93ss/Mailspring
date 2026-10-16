// Offline workload checks: no account, provider connection, or real mail is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const ts = require('typescript');
const React = require('../app/node_modules/react');
const baseline = process.argv.includes('--baseline');
const root = path.resolve(__dirname, '..');

function load(file, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  const context = {
    exports: {},
    console,
    Promise,
    Map,
    Set,
    WeakMap,
    Date,
    setTimeout,
    clearTimeout,
    AppEnv: { config: { get: () => false } },
    require: (name) => dependencies[name] || {},
  };
  vm.runInNewContext(code, context, { filename: file });
  return context.exports;
}

function setup(
  account = {
    provider: 'smartermail',
    settings: { smartermail_server: 'https://example.invalid' },
  }
) {
  const counts = { triggers: 0, fetched: [], files: [], queries: 0 };
  const actions = {
    fetchBodies: (messages) => counts.fetched.push(...messages),
    fetchFile: (file) => counts.files.push(file.id),
  };
  class Store {
    listenTo() {}
    trigger() {
      counts.triggers++;
    }
  }
  class Message {
    static attributes = { body: {} };
    constructor(fields) {
      Object.assign(this, fields);
    }
    isHidden() {
      return false;
    }
  }
  let rows = [];
  const database = {
    findAll() {
      counts.queries++;
      return {
        where() {
          return this;
        },
        include() {
          return this;
        },
        then: (callback) => Promise.resolve(rows).then(callback),
      };
    },
  };
  const workspace = { Sheet: { Conversation: 'conversation' }, rootSheet: () => 'split' };
  const store = load('app/src/flux/stores/message-store.ts', {
    'summermail-store': { default: Store },
    '../actions': actions,
    '../models/message': { Message },
    './database-store': { default: database },
    './focused-perspective-store': {
      default: { current: () => ({ categoriesSharedRole: () => 'inbox' }) },
    },
    './workspace-store': { default: workspace },
    './account-store': {
      AccountStore: {
        accountForId: () => account,
      },
    },
  }).MessageStore;
  store._thread = { id: 'thread', unread: false };
  store._lastMarkedAsReadThreadId = 'thread';
  actions.toggleMessageIdExpanded = (id) => store._onToggleMessageIdExpanded(id);
  actions.expandMessageIds = (ids) => store._onExpandMessageIds(ids);
  const MessageList = load('app/internal_packages/message-list/lib/message-list.tsx', {
    react: { default: React },
    'summermail-exports': {
      Actions: actions,
      MessageStore: store,
      SearchableComponentMaker: { extend: (component) => component },
    },
  }).default;
  const list = new MessageList({});
  list.state = { messagesExpandedState: {} };
  list.setState = (changes) => Object.assign(list.state, changes);
  return {
    store,
    counts,
    Message,
    list,
    workspace,
    rows: (value) => {
      rows = value;
    },
  };
}

async function main() {
  const f = setup();
  const messages = Array.from(
    { length: 500 },
    (_, index) =>
      new f.Message({
        id: 'message-' + index,
        threadId: 'thread',
        accountId: 'account',
        draft: false,
        unread: false,
        body: null,
        files: [],
      })
  );
  f.rows(messages);
  f.store._itemsLoading = true;
  await f.store._fetchFromCache();
  console.log(`500-message initial load: ${f.counts.fetched.length} message bodies queued`);
  if (!baseline)
    assert.deepEqual(
      f.counts.fetched.map((message) => message.id),
      ['message-499']
    );

  f.counts.fetched = [];
  f.counts.triggers = 0;
  const start = performance.now();
  f.list._expandMinifiedBundle({ type: 'minifiedBundle', messages: messages.slice(1, -1) });
  console.log(
    `Expand 498 older messages: ${f.counts.triggers} store updates, ${(performance.now() - start).toFixed(2)} ms of dispatch work`
  );
  if (!baseline) {
    assert.equal(f.counts.triggers, 1);
    assert.equal(f.counts.fetched.length, 498);
    assert.equal(f.store._itemsExpanded['message-0'], undefined);
    assert.equal(f.store._itemsExpanded['message-499'], 'default');
    f.counts.fetched = [];
    f.counts.triggers = 0;
    f.store._onExpandMessageIds(['message-1', 'missing', 'message-1']);
    assert.equal(f.counts.triggers, 0, 'Already expanded IDs must not trigger another update');
    f.store._onToggleMessageIdExpanded('message-1');
    assert.equal(f.counts.fetched.length, 0, 'Collapsing must not fetch a body');
    f.store._onToggleMessageIdExpanded('message-1');
    assert.deepEqual(
      f.counts.fetched.map((message) => message.id),
      ['message-1']
    );
  }

  if (!baseline) {
    const f = setup();
    const items = [
      new f.Message({ id: 'unread', body: null, unread: true, files: [] }),
      new f.Message({ id: 'history', body: null, files: [] }),
      new f.Message({ id: 'draft', body: 'My reply', draft: true, files: [] }),
      new f.Message({ id: 'latest', body: null, files: [] }),
    ];
    f.rows(items);
    f.store._itemsLoading = true;
    await f.store._fetchFromCache();
    assert.deepEqual(
      f.counts.fetched.map((message) => message.id),
      ['unread', 'latest']
    );
    assert.equal(f.store._itemsExpanded.draft, 'default');
    f.counts.fetched = [];
    f.counts.triggers = 0;
    f.store._onToggleAllMessagesExpanded();
    assert.equal(f.counts.triggers, 1);
    assert.deepEqual(
      f.counts.fetched.map((message) => message.id),
      ['unread', 'history', 'latest']
    );
    f.counts.fetched = [];
    f.store._onToggleAllMessagesExpanded();
    assert.deepEqual(Object.keys(f.store._itemsExpanded), ['latest']);
    assert.equal(f.counts.fetched.length, 0);
    f.store._onFocusMessageInThread({ threadId: 'thread', messageId: 'history' });
    assert.equal(f.store._itemsExpanded.history, 'explicit');
    assert.deepEqual(
      f.counts.fetched.map((message) => message.id),
      ['history']
    );
    f.counts.fetched = [];
    f.counts.triggers = 0;
    f.store._onShowAllMessagesExpanded();
    assert.equal(f.counts.triggers, 1);
    assert.equal(f.store._showingHiddenItems, true);
    assert.deepEqual(
      f.counts.fetched.map((message) => message.id),
      ['unread', 'history', 'latest']
    );

    const conversation = setup();
    conversation.workspace.rootSheet = () => 'conversation';
    conversation.rows(items);
    conversation.store._itemsLoading = true;
    await conversation.store._fetchFromCache();
    assert.deepEqual(
      conversation.counts.fetched.map((message) => message.id),
      ['unread', 'history', 'latest']
    );
  }

  if (!baseline) {
    const f = setup();
    const boundary = new f.Message({
      id: 'hex-boundary',
      body: '0000000000009ba7be065df4973d--',
      files: [],
    });
    const coolingDown = new f.Message({
      id: 'boundary-cooldown',
      body: boundary.body,
      smHtmlRepairAttempt: Date.now() / 1000,
      files: [],
    });
    const healthy = new f.Message({ id: 'healthy', body: 'A normal reply --', files: [] });
    f.rows([boundary, coolingDown, healthy]);
    await f.store._fetchFromCache();
    assert.equal(f.counts.fetched.length, 0, 'Collapsed boundary repair must wait until opened');
    f.store._onExpandMessageIds(['hex-boundary', 'boundary-cooldown']);
    assert.deepEqual(
      f.counts.fetched.map((message) => message.id),
      ['hex-boundary']
    );
    f.counts.fetched = [];
    coolingDown.smHtmlRepairAttempt -= 16 * 60;
    f.store._fetchMissingBodies([coolingDown, healthy]);
    assert.deepEqual(
      f.counts.fetched.map((message) => message.id),
      ['boundary-cooldown']
    );
    for (const account of [
      null,
      { provider: 'imap', settings: {} },
      { provider: 'smartermail', settings: {} },
    ]) {
      const other = setup(account);
      other.store._fetchMissingBodies([boundary]);
      assert.equal(
        other.counts.fetched.length,
        0,
        'Boundary repair requires a SmarterMail API account'
      );
    }
  }

  if (!baseline) {
    const f = setup();
    const escaped = new f.Message({
      id: 'escaped',
      body: '&lt;html&gt;Offer&lt;/html&gt;',
      files: [],
    });
    const coolingDown = new f.Message({
      id: 'cooldown',
      body: escaped.body,
      smHtmlRepairAttempt: Date.now() / 1000,
      files: [],
    });
    const attachments = new f.Message({
      id: 'attachments',
      body: 'Cached text',
      smHasAttachments: true,
      files: [],
    });
    const blocked = new f.Message({
      id: 'blocked',
      body: '<img src="https://example.invalid/interface/img/s.png">',
      files: [],
    });
    const healthy = new f.Message({ id: 'healthy', body: '<p>Ready to read</p>', files: [] });
    f.rows([escaped, coolingDown, attachments, blocked, healthy]);
    f.store._itemsLoading = true;
    await f.store._fetchFromCache();
    assert.equal(
      f.counts.fetched.length,
      0,
      'Collapsed repairs must wait until their message is opened'
    );
    f.store._onExpandMessageIds(['escaped', 'cooldown', 'attachments', 'blocked']);
    assert.deepEqual(
      f.counts.fetched.map((message) => message.id),
      ['escaped', 'attachments', 'blocked']
    );
    coolingDown.smHtmlRepairAttempt -= 16 * 60;
    f.counts.fetched = [];
    f.store._fetchMissingBodies([coolingDown]);
    assert.deepEqual(
      f.counts.fetched.map((message) => message.id),
      ['cooldown']
    );
  }

  const underscore = require('underscore');
  const utils = load('app/src/flux/models/utils.ts', { underscore: { default: underscore } });
  const renderDependencies = {
    react: { default: React },
    'summermail-exports': { Utils: utils, DraftStore: { sendStateForDraft: () => null } },
  };
  const helperPath = 'app/internal_packages/message-list/lib/message-render-props-equal.ts';
  if (fs.existsSync(path.join(root, helperPath)))
    renderDependencies['./message-render-props-equal'] = load(helperPath, {
      'summermail-exports': { Utils: utils },
    });
  const Container = load(
    'app/internal_packages/message-list/lib/message-item-container.tsx',
    renderDependencies
  ).default;
  let reads = 0;
  const previous = Array.from({ length: 500 }, (_, id) => ({
    id,
    get subject() {
      reads++;
      return 'Subject ' + id;
    },
    body: 'Email content',
  }));
  const next = previous.map((message, id) => ({
    id,
    get subject() {
      reads++;
      return 'Subject ' + id;
    },
    body: 'Email content',
  }));
  const comparisonStart = performance.now();
  for (let index = 0; index < previous.length; index++) {
    const component = new Container({
      message: previous[index],
      messages: previous,
      thread: { id: 'thread' },
      collapsed: true,
    });
    assert.equal(
      component.shouldComponentUpdate({ ...component.props, messages: next }, component.state),
      false
    );
  }
  console.log(
    `500 unchanged message comparisons: ${reads} subject reads, ${(performance.now() - comparisonStart).toFixed(2)} ms`
  );
  if (!baseline) {
    assert.ok(reads <= 2000, 'The full collection must be compared once, rather than once per row');
    const changed = next.slice();
    changed[499] = { id: 499, subject: 'Changed subject', body: 'Email content' };
    const component = new Container({
      message: previous[0],
      messages: previous,
      thread: { id: 'thread' },
      collapsed: true,
    });
    assert.equal(
      component.shouldComponentUpdate({ ...component.props, messages: changed }, component.state),
      true,
      'Header extensions must still see changes elsewhere in the thread'
    );
    assert.equal(
      component.shouldComponentUpdate({ ...component.props, collapsed: false }, component.state),
      true
    );
    assert.equal(
      component.shouldComponentUpdate(
        { ...component.props, message: { ...previous[0], unread: true } },
        component.state
      ),
      true
    );
    assert.equal(
      component.shouldComponentUpdate(component.props, { sendState: { phase: 'sending' } }),
      true
    );
    console.log(
      'PASS: lazy body loading, single-update bulk expansion, individual expand/collapse, shared collection comparisons, and thread-wide extension updates.'
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
