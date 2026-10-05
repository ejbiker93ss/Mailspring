// Offline regression checks. Uses an in-memory cache and a fake sync bridge;
// never opens a user's database, calls a provider, or downloads attachments.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const SQLite = require('better-sqlite3');
const modules = new Map();
const db = new SQLite(':memory:');
db.exec(
  'CREATE TABLE Thread(id TEXT, data TEXT); CREATE TABLE Message(id TEXT, threadId TEXT, data TEXT);'
);

function load(relative, dependencies = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  if (modules.has(filename)) return modules.get(filename);
  const exports = {};
  modules.set(filename, exports);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(
    output,
    {
      exports,
      Map,
      Set,
      Promise,
      setTimeout: (fn) => setTimeout(fn, 0),
      require: (name) => {
        if (name in dependencies) return dependencies[name];
        if (name.startsWith('.'))
          return load(
            path.relative(
              path.resolve(__dirname, '..'),
              path.resolve(path.dirname(filename), name + '.ts')
            ),
            dependencies
          );
        throw new Error('Unexpected dependency: ' + name);
      },
    },
    { filename }
  );
  return exports;
}

const Parser = load('app/src/services/search/search-query-parser.ts').SearchQueryParser;
const Backend = load('app/src/services/search/search-query-backend-local.ts', {
  'summermail-exports': { DateUtils: {} },
}).default;
for (const [id, attachmentCount, message] of [
  ['unopened', 0, { smHasAttachments: true, files: [] }],
  ['ordinary', 0, { smHasAttachments: false, files: [] }],
  ['hydrated', 1, { files: [{ filename: 'report.csv' }] }],
  ['missing-fields', 0, {}],
]) {
  db.prepare('INSERT INTO Thread VALUES (?, ?)').run(id, JSON.stringify({ attachmentCount }));
  db.prepare('INSERT INTO Message VALUES (?, ?, ?)').run(
    id + '-message',
    id,
    JSON.stringify(message)
  );
}
const attachmentSQL = new Backend('Thread').compile(Parser.parse('has:attachment'));
assert.deepStrictEqual(
  db
    .prepare('SELECT id FROM Thread WHERE ' + attachmentSQL + ' ORDER BY id')
    .all()
    .map((r) => r.id),
  ['hydrated', 'unopened']
);
assert.deepStrictEqual(
  db
    .prepare('SELECT id FROM Thread WHERE NOT ' + attachmentSQL + ' ORDER BY id')
    .all()
    .map((r) => r.id),
  ['missing-fields', 'ordinary']
);
console.log(
  'PASS: unopened SmarterMail attachment hints match even with attachmentCount zero; absent metadata is not a positive match.'
);
db.close();

class Thread {}
class Message {}
const attr = (field) => ({
  descending: () => ({ field, desc: true }),
  ascending: () => ({ field, desc: false }),
  in: (values) => ({ field, values }),
});
Thread.attributes = {
  lastMessageReceivedTimestamp: attr('lastMessageReceivedTimestamp'),
  accountId: attr('accountId'),
};
Message.attributes = { date: attr('date'), body: 'body' };
let threads = [];
let messages = [];
let requests = [];
let observedLimits = [];
let hydrate = true;
class Query {
  constructor(klass, filter) {
    this.klass = klass;
    this.filters = filter ? [filter] : [];
    this.max = Infinity;
    this.skip = 0;
  }
  where(filter) {
    this.filters.push(filter);
    return this;
  }
  structuredSearch(ast) {
    this.ast = ast;
    return this;
  }
  search() {
    return this;
  }
  order(order) {
    this.sort = order;
    return this;
  }
  offset(value) {
    this.skip = value;
    return this;
  }
  limit(value) {
    this.max = value;
    observedLimits.push(value);
    return this;
  }
  include() {
    return this;
  }
  background() {
    return this;
  }
  then(resolve, reject) {
    let rows = this.klass === Thread ? threads : messages;
    rows = rows.filter((row) =>
      this.filters.every((filter) =>
        Object.entries(filter).every(([key, value]) =>
          Array.isArray(value) ? value.includes(row[key]) : row[key] === value
        )
      )
    );
    if (this.sort)
      rows = rows
        .slice()
        .sort((a, b) => (a[this.sort.field] - b[this.sort.field]) * (this.sort.desc ? -1 : 1));
    return Promise.resolve(rows.slice(this.skip, this.skip + this.max)).then(resolve, reject);
  }
}
const access = {
  checkAccountAccess: (id) => (id === 'blocked' ? 'Denied' : null),
  checkFolderAccess: () => null,
  getAllowedAccountIds: (ids) => ids.filter((id) => id !== 'blocked'),
  isFolderAllowed: () => true,
  isThreadAllowed: (t) => t.accountId !== 'blocked' && !t.excluded,
  isMessageAllowed: (m) => m.accountId !== 'blocked' && !m.excluded,
};
const serializers = load('app/internal_packages/mcp-server/lib/mcp-serializers.ts', {
  './mcp-access-control': access,
});
const client = load('app/internal_packages/message-list/lib/mcp-mail-assistant-client.ts', {
  'summermail-exports': {
    Thread,
    Message,
    SearchQueryParser: Parser,
    AccountStore: { accounts: () => [] },
    CategoryStore: {},
    DatabaseStore: {
      findAll: (klass, filter) => new Query(klass, filter),
      find: async (klass, id) => threads.find((t) => t.id === id),
    },
    Actions: {
      fetchBodies: (pending) => {
        requests.push(pending.map((m) => m.id));
        if (hydrate)
          messages = messages.map((m) =>
            pending.some((p) => p.id === m.id)
              ? {
                  ...m,
                  body: 'Cached text',
                  smAttachmentHydratedV1: true,
                  files: [
                    { displayName: () => '2025 Taxes.csv', contentType: 'text/csv', size: 32 },
                  ],
                }
              : m
          );
      },
    },
  },
  '../../mcp-server/lib/mcp-access-control': access,
  '../../mcp-server/lib/mcp-serializers': serializers,
  './mail-assistant-email-links': { mailAssistantThreadHref: (id) => '#summermail-thread=' + id },
});

async function run() {
  threads = Array.from({ length: 45 }, (_, index) => ({
    id: 'thread-' + index,
    accountId: 'focused',
    subject: 'Tax meeting ' + index,
    lastMessageReceivedTimestamp: 100 - index,
    participants: [],
    categories: [],
    attachmentCount: 0,
  }));
  const scope = { defaultAccountId: 'focused', hydrationBudget: { remaining: 12 } };
  const page1 = JSON.parse(
    await client.callMailboxReadTool(
      'search_mail',
      { query: 'to:cbohannon@paulhood.com', limit: 30 },
      scope
    )
  );
  assert.strictEqual(page1.threads.length, 30);
  assert.strictEqual(page1.nextOffset, 30);
  assert.strictEqual(page1.source, 'local-cache');
  const page2 = JSON.parse(
    await client.callMailboxReadTool(
      'search_mail',
      { query: 'to:cbohannon@paulhood.com', offset: page1.nextOffset, limit: 30 },
      scope
    )
  );
  assert.strictEqual(page2.threads[0].id, 'thread-30');
  assert.strictEqual(page2.threads.length, 15);
  assert.strictEqual(page2.nextOffset, null);
  assert.strictEqual(requests.length, 0, 'Search must not fetch bodies for all result rows');
  assert.strictEqual(page1.accountId, 'focused');
  const originalThreads = threads;
  threads.push({ id: 'personal-match', accountId: 'personal', lastMessageReceivedTimestamp: 200 });
  const focused = JSON.parse(
    await client.callMailboxReadTool(
      'search_mail',
      { query: 'to:cbohannon@paulhood.com', accountId: 'personal' },
      scope
    )
  );
  assert(
    !focused.threads.some((t) => t.id === 'personal-match'),
    'A model-selected account cannot escape focused-account scope'
  );
  threads = originalThreads.filter((t) => t.id !== 'personal-match');
  console.log(
    'PASS: search pages older cached mail without repeating page one and reports its coverage/account while preserving focused-account authorization.'
  );

  messages = Array.from({ length: 20 }, (_, i) => ({
    id: 'message-' + i,
    accountId: 'focused',
    threadId: 'thread-0',
    date: i,
    body: null,
    smHasAttachments: true,
    smAttachmentHydratedV1: false,
    files: [],
    excluded: i === 0,
  }));
  const thread = JSON.parse(
    await client.callMailboxReadTool('get_thread', { threadId: 'thread-0' }, scope)
  );
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].length, 3);
  assert(!requests[0].includes('message-0'), 'Excluded messages cannot be sent to sync');
  assert.strictEqual(scope.hydrationBudget.remaining, 9);
  assert(
    !thread.messages.some((m) => m.id === 'message-0'),
    'Excluded message details cannot be returned'
  );
  assert(thread.messages.some((m) => m.attachments.some((f) => f.filename === '2025 Taxes.csv')));
  assert(thread.messages.some((m) => m.attachmentMetadataStatus === 'pending'));
  console.log(
    'PASS: reads hydrate just three permitted messages, expose filenames/types, and keep other unloaded files pending.'
  );

  hydrate = false;
  scope.hydrationBudget.remaining = 1;
  const offline = JSON.parse(
    await client.callMailboxReadTool('get_thread', { threadId: 'thread-0' }, scope)
  );
  assert.strictEqual(requests.at(-1).length, 1);
  assert.strictEqual(scope.hydrationBudget.remaining, 0);
  assert(offline.messages.some((m) => m.attachmentMetadataStatus === 'pending'));
  const requestCount = requests.length;
  await client.callMailboxReadTool('get_thread', { threadId: 'thread-0' }, scope);
  assert.strictEqual(requests.length, requestCount, 'Request hydration budget cannot be exceeded');
  messages = Array.from({ length: 120 }, (_, i) => ({
    id: 'large-thread-' + i,
    accountId: 'focused',
    threadId: 'thread-0',
    date: i,
    body: 'Loaded',
    files: [],
  }));
  const largeThread = JSON.parse(
    await client.callMailboxReadTool('get_thread', { threadId: 'thread-0' }, scope)
  );
  assert.strictEqual(largeThread.messages.length, 100);
  assert.strictEqual(largeThread.messages[0].id, 'large-thread-20');
  assert.strictEqual(largeThread.messagesTruncated, true);
  assert.strictEqual(requests.length, requestCount);
  threads[0].excluded = true;
  await assert.rejects(
    () => client.callMailboxReadTool('get_thread', { threadId: 'thread-0' }, scope),
    /not found/
  );
  assert.strictEqual(requests.length, requestCount);
  console.log(
    'PASS: offline wait is bounded; hydration budget and excluded-thread authorization remain enforced.'
  );
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
