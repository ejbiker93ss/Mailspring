// Offline regressions against the real draft store/factory with delayed local saves.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const tasks = [];
  const saves = [];
  const discarded = new Set();
  const restored = [];
  let preparations = 0;
  let databaseReads = 0;
  const storeModule = {};
  const messageStore = {
    threadId: () => 'thread', items: () => [],
    dismissDraft(id) {
      if (discarded.has(id)) return false;
      discarded.add(id);
      return true;
    },
    restoreDraft(id) {
      discarded.delete(id);
      restored.push(id);
    },
  };
  class Store {
    listenTo() {}
  }
  class Message {
    constructor(fields) {
      Object.assign(this, fields);
    }
  }
  class Session {
    constructor(id, draft) {
      this.headerMessageId = id;
      this.value = draft;
    }
    draft() {
      return this.value;
    }
    teardown() {
      this.destroyed = true;
    }
  }
  const dependencies = {
    electron: { ipcRenderer: { on() {} } },
    'summermail-store': { default: Store },
    './draft-editing-session': { DraftEditingSession: Session },
    './send-actions-store': { SendActionsStore: {} },
    './message-store': { MessageStore: messageStore },
    '../models/message': { Message },
    '../tasks/destroy-draft-task': {
      DestroyDraftTask: class { constructor(fields) { Object.assign(this, fields); } },
    },
    '../tasks/send-draft-task': { SendDraftTask: class {} },
    '../tasks/syncback-draft-task': {
      SyncbackDraftTask: class {
        constructor({ draft }) {
          this.draft = draft;
        }
      },
    },
    './task-queue': {
      default: {
        queue: () => [],
        waitForPerformLocal() {
          const save = deferred();
          saves.push(save);
          return save.promise;
        },
      },
    },
    './database-store': {
      default: {
        findAll() {
          databaseReads++;
          throw new Error('Unexpected database read');
        },
      },
    },
    '../actions': { queueTask: (task) => tasks.push(task) },
    '../../registries/extension-registry': {
      Composer: {
        extensions: () => [
          {
            prepareNewDraft() {
              preparations++;
            },
          },
        ],
      },
    },
    './draft-store': storeModule,
  };
  function load(name) {
    const file = path.join(__dirname, '..', 'app/src/flux/stores', name + '.ts');
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const context = {
      exports: {},
      Promise,
      Map,
      console,
      process: { env: {} },
      setInterval() {},
      AppEnv: { isMainWindow: () => false, isComposerWindow: () => false, onBeforeUnload() {} },
      require: (name) => dependencies[name] || {},
    };
    vm.runInNewContext(code, context, { filename: file });
    return context.exports.default;
  }
  const factory = load('draft-factory');
  dependencies['./draft-factory'] = { default: factory };
  const store = load('draft-store');
  storeModule.default = store;
  const message = new Message({
    id: 'message',
    accountId: 'account',
    threadId: 'thread',
    headerMessageId: 'parent',
  });
  const thread = { id: 'thread', accountId: 'account' };
  const context = { thread, message, type: 'reply', behavior: 'prefer-existing-if-pristine' };
  store._modelifyContext = async (value) => ({ thread: value.thread, message: value.message });
  let created = 0;
  factory.createDraftForReply = async ({ message }) =>
    new Message({
      id: 'draft-' + ++created,
      headerMessageId: 'draft-header-' + created,
      accountId: message.accountId,
      threadId: message.threadId,
      replyToMessageId: message.id,
      replyToHeaderMessageId: message.headerMessageId,
      body: 'quoted original',
      draft: true,
      pristine: true,
      to: [],
      cc: [],
    });
  factory.updateDraftForReply = (draft) => draft;
  return {
    store,
    factory,
    context,
    message,
    messageStore,
    tasks,
    saves,
    discarded,
    restored,
    created: () => created,
    preparations: () => preparations,
    databaseReads: () => databaseReads,
  };
}

async function until(condition) {
  for (let turn = 0; turn < 50 && !condition(); turn++) await Promise.resolve();
  assert.ok(condition(), 'Operation did not reach the expected asynchronous stage');
}

(async () => {
  for (const failed of [false, true]) {
    const f = fixture();
    const opening = f.store._onComposeReply(f.context);
    await until(() => f.saves.length === 1);
    f.saves[0].resolve();
    const { draft, headerMessageId } = await opening;
    const session = f.store._draftSessions[headerMessageId];
    f.store._onDestroyDraft(draft);
    assert.equal(session.destroyed, true, 'Stop autosaving before unmounting the composer');
    assert.equal(f.store._draftSessions[headerMessageId], undefined);
    assert.ok(f.discarded.has(draft.id), 'Dismiss without waiting for local deletion');
    assert.equal(f.tasks.length, 2, 'Queue one create and one delete');
    f.store._onDestroyDraft(draft);
    assert.equal(f.tasks.length, 2, 'Repeated trash clicks must not duplicate deletion');
    f.saves[1].resolve({ status: 'complete', error: failed ? { message: 'No trash folder' } : null });
    await until(() => failed ? f.restored.length === 1 : f.store._pendingReplies.size === 0);
    await Promise.resolve();
    assert.equal(f.discarded.has(draft.id), !failed);
    assert.equal(f.restored.length, failed ? 1 : 0, 'A failed local deletion restores access');
  }
  {
    const f = fixture();
    const resolution = deferred();
    let resolutions = 0;
    f.store._modelifyContext = () => {
      resolutions++;
      return resolution.promise;
    };
    const clicks = Array.from({ length: 6 }, () => f.store._onComposeReply(f.context));
    assert.equal(resolutions, 1, 'Repeated clicks must share even the initial context lookup');
    resolution.resolve(f.context);
    await until(() => f.saves.length === 1);
    const laterClick = f.store._onComposeReply(f.context);
    assert.equal(resolutions, 1, 'Deduplication must last through a slow local save');
    assert.equal(f.created(), 1);
    assert.equal(f.tasks.length, 1);
    f.saves[0].resolve();
    const results = await Promise.all([...clicks, laterClick]);
    assert.ok(results.every((result) => result.draft === results[0].draft));
    assert.equal(f.store._pendingReplies.size, 0);

    const session = f.store._draftSessions[results[0].headerMessageId];
    const reopened = f.store._onComposeReply(f.context);
    await until(() => f.saves.length === 2);
    assert.equal(f.created(), 1, 'A session must be reused before MessageStore receives its draft');
    assert.equal(f.store._draftSessions[results[0].headerMessageId], session);
    assert.equal(f.preparations(), 1, 'Reopening must not run new-draft extensions again');
    f.saves[1].resolve();
    assert.equal((await reopened).draft, results[0].draft);
  }
  {
    const f = fixture();
    const quoting = deferred();
    let quoteCalls = 0;
    const create = f.factory.createDraftForReply;
    f.factory.createDraftForReply = async (args) => {
      quoteCalls++;
      await quoting.promise;
      return create(args);
    };
    const clicks = [f.store._onComposeReply(f.context), f.store._onComposeReply(f.context)];
    await until(() => quoteCalls === 1);
    assert.equal(f.tasks.length, 0);
    quoting.resolve();
    await until(() => f.saves.length === 1);
    f.saves[0].resolve();
    await Promise.all(clicks);
    assert.equal(quoteCalls, 1, 'Slow body preparation must create only one reply');
  }
  {
    const f = fixture();
    const failure = new Error('Could not prepare reply');
    const create = f.factory.createDraftForReply;
    f.factory.createDraftForReply = async () => {
      throw failure;
    };
    await assert.rejects(f.store._onComposeReply(f.context), (error) => error === failure);
    assert.equal(f.store._pendingReplies.size, 0, 'A failed attempt must permit retry');
    f.factory.createDraftForReply = create;
    const retry = f.store._onComposeReply(f.context);
    await until(() => f.saves.length === 1);
    f.saves[0].resolve();
    await retry;
  }
  {
    const f = fixture();
    const other = {
      ...f.context,
      message: { ...f.message, id: 'other', headerMessageId: 'other-parent' },
    };
    const pending = [f.store._onComposeReply(f.context), f.store._onComposeReply(other)];
    await until(() => f.saves.length === 2);
    assert.equal(f.created(), 2, 'Replies to different messages must remain independent');
    f.saves.forEach((save) => save.resolve());
    await Promise.all(pending);
  }
  {
    const f = fixture();
    const draft = await f.factory.createDraftForReply(f.context);
    f.store._draftSessions[draft.headerMessageId] = { draft: () => draft };
    draft.pristine = false;
    assert.equal(
      await f.factory.candidateDraftForUpdating(f.message, 'prefer-existing-if-pristine'),
      null
    );
    assert.equal(await f.factory.candidateDraftForUpdating(f.message, 'prefer-existing'), draft);
    draft.pristine = true;
    draft.accountId = 'different-account';
    assert.equal(await f.factory.candidateDraftForUpdating(f.message, 'prefer-existing'), null);
    draft.accountId = f.message.accountId;
    draft.threadId = 'different-thread';
    assert.equal(await f.factory.candidateDraftForUpdating(f.message, 'prefer-existing'), null);
    draft.threadId = f.message.threadId;
    delete draft.replyToHeaderMessageId;
    delete f.message.headerMessageId;
    assert.equal(await f.factory.candidateDraftForUpdating(f.message, 'prefer-existing'), draft);
    draft.replyToMessageId = 'other-message';
    assert.equal(await f.factory.candidateDraftForUpdating(f.message, 'prefer-existing'), null);
    assert.equal(
      f.databaseReads(),
      0,
      'Active conversations and sessions must not require another database read'
    );
  }
  console.log(
    'PASS: delayed context, quoting and persistence coalesce repeated clicks; active sessions reuse drafts without losing edits or repeating extensions; failures allow retry; reply targets remain isolated.'
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
