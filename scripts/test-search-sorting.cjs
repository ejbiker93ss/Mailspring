// Offline regression checks against real SQLite/FTS5 and production query builders.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const SQLite = require('better-sqlite3');
const root = path.resolve(__dirname, '..');
const db = new SQLite(':memory:');
const cache = new Map();
const exportsStub = {
  DateUtils: {},
  Thread: { attributes: { subject: {} } },
  MutableQuerySubscription: class {},
};
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename);
  const module = { exports: {} };
  cache.set(filename, module.exports);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      Map,
      Set,
      Promise,
      console,
      require: (name) => {
        if (name === 'summermail-exports') return exportsStub;
        if (name === 'underscore') return require(name);
        if (name.startsWith('.'))
          return load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts')));
        throw new Error('Unexpected dependency: ' + name);
      },
    },
    { filename }
  );
  return module.exports;
}

db.exec(`CREATE TABLE Thread(id TEXT PRIMARY KEY, accountId TEXT, subject TEXT, unread INTEGER, lastMessageReceivedTimestamp INTEGER, lastMessageSentTimestamp INTEGER, data TEXT);
CREATE TABLE Message(id TEXT PRIMARY KEY, threadId TEXT, date INTEGER, data TEXT, accountId TEXT);
CREATE INDEX MessageThread ON Message(threadId);
CREATE VIRTUAL TABLE ThreadSearch USING fts5(subject, to_, from_, body, categories, content_id UNINDEXED);`);
db.exec(`ATTACH DATABASE ':memory:' AS attachmentSearch;
CREATE VIRTUAL TABLE attachmentSearch.AttachmentText USING fts5(text, key UNINDEXED, messageId UNINDEXED, accountId UNINDEXED, fileId UNINDEXED);`);
const Parser = load('app/src/services/search/search-query-parser.ts').SearchQueryParser;
const Backend = load('app/src/services/search/search-query-backend-local.ts').default;
const { threadSortSQL } = load('app/src/services/mail-sort.ts');
const { filterAndSortVisibleItems } = load(
  'app/internal_packages/thread-list/lib/unthreaded-list-ordering.ts'
);
const insertThread = db.prepare('INSERT INTO Thread VALUES (?, ?, ?, ?, ?, ?, ?)');
const insertMessage = db.prepare('INSERT INTO Message VALUES (?, ?, ?, ?, ?)');
const insertFTS = db.prepare('INSERT INTO ThreadSearch VALUES (?, ?, ?, ?, ?, ?)');
function seed(id, size, date, subject, sender, unread = 1, account = 'a') {
  insertThread.run(id, account, subject, unread, date, date, '{}');
  insertMessage.run(
    id + '-message',
    id,
    date,
    JSON.stringify({ size, from: [{ name: sender, email: sender + '@example.com' }], files: [] }),
    account
  );
  insertFTS.run(subject, '', sender, 'report', 'Inbox', id);
}
seed('old-large', 12 * 1024 * 1024, 1, 'Zulu report', 'Zoe');
seed('new-small', 1024, 5, 'alpha report', 'alice');
seed('unknown', undefined, 6, 'Beta report', 'Bob');
seed('read', 20 * 1024 * 1024, 4, 'read report', 'reader', 0);
seed('other-account', 30 * 1024 * 1024, 3, 'other report', 'other', 1, 'b');
function search(query) {
  return db
    .prepare(
      'SELECT id FROM Thread WHERE ' +
        new Backend('Thread').compile(Parser.parse(query)) +
        ' ORDER BY id'
    )
    .all()
    .map((r) => r.id);
}
assert.deepEqual(search('larger:10M smaller:15M'), ['old-large']);
assert.deepEqual(search('size:1024 smaller:2K'), ['new-small']);
assert.deepEqual(search('larger:1.5MB smaller:15M'), ['old-large']);
assert.deepEqual(search('smaller:1K'), []); // Unknown is not zero; bounds are strict.
assert.deepEqual(search('size:12M smaller:13M'), ['old-large']);
assert.throws(() => Parser.parse('larger:infinity'));
assert.throws(() => Parser.parse('larger:99999999999999999999G'));
const order = (field, ascending) =>
  db
    .prepare(
      `SELECT id FROM Thread WHERE accountId='a' AND unread=1 ORDER BY ${threadSortSQL(field, ascending)}`
    )
    .all()
    .map((r) => r.id);
assert.deepEqual(order('size', false), ['old-large', 'new-small', 'unknown']);
assert.deepEqual(order('size', true), ['new-small', 'old-large', 'unknown']);
assert.deepEqual(order('from', true), ['new-small', 'unknown', 'old-large']);
assert.deepEqual(order('subject', false), ['old-large', 'unknown', 'new-small']);
assert.deepEqual(order('date', true), ['old-large', 'new-small', 'unknown']);
const items = db
  .prepare(
    "SELECT Message.id, Message.data, Message.date FROM Message JOIN Thread ON Thread.id=Message.threadId WHERE Thread.accountId='a' AND Thread.unread=1"
  )
  .all()
  .map((row) => ({
    message: { ...JSON.parse(row.data), id: row.id, date: new Date(row.date * 1000) },
  }));
assert.deepEqual(
  Array.from(
    filterAndSortVisibleItems(items, {
      unreadOnly: false,
      sortField: 'size',
      sortAscending: false,
    }),
    (i) => i.message.id
  ),
  ['old-large-message', 'new-small-message', 'unknown-message']
);
assert.deepEqual(
  Array.from(
    filterAndSortVisibleItems(items, { unreadOnly: false, sortField: 'size', sortAscending: true }),
    (i) => i.message.id
  ),
  ['new-small-message', 'old-large-message', 'unknown-message']
);
const ranked = items.map((item, index) => ({ ...item, searchRank: index }));
assert.equal(
  filterAndSortVisibleItems(ranked, {
    unreadOnly: false,
    sortField: 'relevance',
    sortAscending: false,
    isSearch: true,
  })[0],
  ranked[0]
);
exportsStub.SearchQueryParser = Parser;
exportsStub.DatabaseStore = { _query: async (sql, values) => db.prepare(sql).all(...values) };
const Subscription = load(
  'app/internal_packages/thread-search/lib/search-query-subscription.ts'
).SearchQuerySubscription;
async function main() {
  const subscription = Object.create(Subscription.prototype);
  subscription._accountIds = ['a'];
  subscription._viewOptions = { sortField: 'size', sortAscending: false, unreadOnly: true };
  // Ensure explicit sorting happens before the 1,000-result cap.
  db.transaction(() => {
    for (let i = 0; i < 1005; i++) seed('filler-' + i, 100, 100 + i, 'report', 'filler');
  })();
  const result = await subscription._rankedSearchResults(Parser.parse('report'));
  assert.equal(result.total, 1008);
  assert.equal(result.ids.length, 1000);
  assert.equal(result.ids[0], 'old-large');
  assert.equal(result.ids.includes('other-account'), false);
  assert.equal(result.ids.includes('read'), false);
  subscription._viewOptions = { sortField: 'date', sortAscending: true, unreadOnly: true };
  assert.equal(
    (await subscription._rankedSearchResults(Parser.parse('report'))).ids[0],
    'old-large'
  );
  subscription._viewOptions = { sortField: 'subject', sortAscending: true, unreadOnly: true };
  assert.equal(
    (await subscription._rankedSearchResults(Parser.parse('report'))).ids[0],
    'new-small'
  );
  // Use a sparse term in a realistic-sized corpus so BM25 separates strong
  // subject matches from incidental body mentions into different bands.
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;
  seed('archive-subject', 100, now - 730 * day, 'orchid', 'archive');
  seed('recent-subject', 100, now - day, 'orchid', 'recent');
  seed('newest-body', 100, now, 'Planning update', 'newest');
  db.prepare("UPDATE ThreadSearch SET body='orchid' WHERE content_id='newest-body'").run();
  subscription._viewOptions = {};
  const byRelevance = await subscription._rankedSearchResults(Parser.parse('orchid'));
  assert.equal(byRelevance.ids[0], 'recent-subject', 'a strong recent match stays above a weaker new one');
  assert.ok(byRelevance.ids.indexOf('newest-body') < byRelevance.ids.indexOf('archive-subject'),
    'a recent body mention beats a years-old subject match');
  assert.deepEqual(
    Array.from((await subscription._rankedSearchResults(Parser.parse('subject:orchid'))).ids),
    ['recent-subject', 'archive-subject'],
    'fielded text searches also favor recent matches'
  );
  subscription._viewOptions = { sortField: 'date', sortAscending: true };
  assert.equal((await subscription._rankedSearchResults(Parser.parse('orchid'))).ids[0],
    'archive-subject', 'explicit oldest-first sorting still wins');
  db.close();
  console.log(
    'PASS: size filters, unknown sizes, explicit sorting, recency-weighted relevance, account/unread scopes, and sorting before the result cap.'
  );
}
main().catch((error) => {
  console.error(error);
  db.close();
  process.exitCode = 1;
});
