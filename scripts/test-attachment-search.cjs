// Run with Electron's Node runtime: the app's SQLite addon targets Electron.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { fork } = require('node:child_process');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(require('electron'), [__filename], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
    encoding: 'utf8',
    timeout: 60000,
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) console.error(result.error);
  process.exit(result.status === 0 ? 0 : 1);
}
const ts = require('typescript');
const SQLite = require('../app/node_modules/better-sqlite3');
const {
  attachIndex,
  openIndex,
  saveResult,
} = require('../app/src/services/attachment-search/index-db');
const { extract, MAX_FILE_BYTES } = require('../app/src/services/attachment-search/extractor');
const {
  AttachmentIndexer,
  extractInProcess,
  localFile,
} = require('../app/src/services/attachment-search/worker');
const appRequire = createRequire(require.resolve('../app/node_modules/mammoth'));
const Zip = appRequire('jszip');
const XLSX = require('../app/src/quickpreview/xlsx-0.18.5/xlsx.full.min.js');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'summermail-attachment-search-'));
const mailPath = path.join(temporary, 'mail.db');
const filesRoot = path.join(temporary, 'files');
const db = new SQLite(mailPath);
const cache = new Map();
const stub = {
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
        if (name === 'summermail-exports') return stub;
        if (name === 'underscore') return require(name);
        if (name.startsWith('.'))
          return load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts')));
        throw new Error('Unexpected import ' + name);
      },
    },
    { filename }
  );
  return module.exports;
}

db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE Thread(id TEXT PRIMARY KEY, accountId TEXT, unread INTEGER, subject TEXT, lastMessageReceivedTimestamp INTEGER, data TEXT);
CREATE TABLE Message(id TEXT PRIMARY KEY, accountId TEXT, threadId TEXT, date INTEGER, data TEXT);
CREATE INDEX MessageThread ON Message(threadId);
CREATE VIRTUAL TABLE ThreadSearch USING fts5(subject, to_, from_, body, categories, content_id UNINDEXED);`);
attachIndex(db, mailPath);
const Parser = load('app/src/services/search/search-query-parser.ts').SearchQueryParser;
const Backend = load('app/src/services/search/search-query-backend-local.ts').default;
stub.DatabaseStore = { _query: async (sql, values) => db.prepare(sql).all(...values) };
const Subscription = load(
  'app/internal_packages/thread-search/lib/search-query-subscription.ts'
).SearchQuerySubscription;

function seed(id, account = 'a', files = [], body = '', subject = 'Quarterly report') {
  db.prepare('INSERT INTO Thread VALUES (?, ?, 1, ?, 1, ?)').run(id, account, subject, '{}');
  db.prepare('INSERT INTO Message VALUES (?, ?, ?, 1, ?)').run(
    id + '-message',
    account,
    id,
    JSON.stringify({ files })
  );
  db.prepare('INSERT INTO ThreadSearch VALUES (?, ?, ?, ?, ?, ?)').run(
    subject,
    '',
    'Alice',
    body,
    'Inbox',
    id
  );
}
function matches(query, account = 'a') {
  return db
    .prepare(
      'SELECT id FROM Thread WHERE accountId = ? AND ' +
        new Backend('Thread').compile(Parser.parse(query)) +
        ' ORDER BY id'
    )
    .all(account)
    .map((r) => r.id);
}
function putFile(id, filename, bytes) {
  const dir = path.join(filesRoot, id.slice(0, 2), id.slice(2, 4), id);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}
function pdf(text) {
  const stream = text ? `BT /F1 12 Tf 50 700 Td (${text}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return out;
}

let indexer;
async function main() {
  const textPath = putFile('aabbcc', 'invoice.txt', 'Attachment-only zirconium amount due');
  const files = [{ id: 'aabbcc', filename: 'invoice.txt', size: fs.statSync(textPath).size }];
  seed('attachment', 'a', files);
  seed('body', 'a', [], 'zirconium');
  seed('other-account', 'b', files);
  let calls = 0;
  indexer = new AttachmentIndexer(mailPath, filesRoot, async (item) => {
    calls++;
    return extract(item.filePath, item.extension);
  });
  const row = (id) =>
    db.prepare('SELECT id, accountId, data FROM Message WHERE id = ?').get(id + '-message');
  await indexer.indexMessage(row('attachment'));
  await indexer.indexMessage(row('attachment'));
  assert.equal(calls, 1, 'unchanged files must not be parsed again');
  await indexer.indexMessage(row('other-account'));
  assert.deepEqual(matches('zirconium'), ['attachment', 'body']);
  assert.deepEqual(matches('zirconium', 'b'), ['other-account']);
  assert.deepEqual(matches('subject:Quarterly zirconium'), ['attachment', 'body']);
  assert.deepEqual(
    matches('Alice zirconium'),
    ['attachment', 'body'],
    'AND must span mail metadata and attachment text'
  );
  assert.deepEqual(matches('zirconium NOT "amount due"'), ['body']);
  assert.deepEqual(matches('"amount due"'), ['attachment']);
  assert.deepEqual(matches('body:zirconium'), ['body'], 'body: must retain its field restriction');
  assert.deepEqual(matches('subject:zirconium'), []);
  assert.deepEqual(matches('zirconium OR nonexistent'), ['attachment', 'body']);
  const subscription = Object.create(Subscription.prototype);
  subscription._accountIds = ['a'];
  subscription._options = { sortField: 'date', sortAscending: true, unreadOnly: true };
  let ranked = await subscription._rankedSearchResults(Parser.parse('zirconium'));
  assert.equal(ranked.total, 2);
  assert.deepEqual(Array.from(ranked.ids).sort(), ['attachment', 'body']);
  ranked = await subscription._rankedSearchResults(Parser.parse('Alice zirconium'));
  assert.equal(ranked.total, 2, 'ranking must retain cross-source matches');
  indexer.close();
  indexer = new AttachmentIndexer(mailPath, filesRoot, async () => {
    throw Error('must use persisted index');
  });
  await indexer.indexMessage(row('attachment'));
  indexer.close();

  // Removed MIME parts and deleted messages must stop matching immediately,
  // even before the background worker has cleaned up their cached text.
  db.prepare("UPDATE Message SET data = '{\"files\":[]}' WHERE id = 'attachment-message'").run();
  assert.deepEqual(matches('"amount due"'), []);
  db.prepare("UPDATE Message SET data = ? WHERE id = 'attachment-message'").run(
    JSON.stringify({ files })
  );
  db.prepare("UPDATE Message SET threadId = 'body' WHERE id = 'attachment-message'").run();
  assert.deepEqual(matches('"amount due"'), ['body'], 'thread moves must use current ownership');
  db.prepare("DELETE FROM Message WHERE id = 'attachment-message'").run();
  assert.deepEqual(matches('"amount due"'), []);

  const pdfPath = putFile('aapdf1', 'report.pdf', pdf('Invoice cobalt payable'));
  assert.match((await extract(pdfPath, 'pdf')).text, /cobalt/);
  const scanPath = putFile('aapdf2', 'scan.pdf', pdf(''));
  assert.equal((await extract(scanPath, 'pdf')).status, 'needs-ocr');
  const malformed = putFile('aapdf3', 'broken.pdf', 'not a PDF');
  assert.equal(
    (await extractInProcess({ filePath: malformed, extension: 'pdf' })).status,
    'failed'
  );
  const extracted = await extractInProcess({ filePath: pdfPath, extension: 'pdf' });
  assert.match(extracted.text, /cobalt/, 'real subprocess must support PDF.js');
  assert.equal(
    (await extractInProcess({ filePath: pdfPath, extension: 'pdf' }, 1)).status,
    'timed-out'
  );

  const doc = new Zip();
  doc.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  doc.file(
    'word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Purchase order tantalum</w:t></w:r></w:p></w:body></w:document>'
  );
  const docPath = putFile('aadoc1', 'order.docx', await doc.generateAsync({ type: 'nodebuffer' }));
  assert.match((await extract(docPath, 'docx')).text, /tantalum/);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['first', 123]]), 'Summary');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['hidden hafnium', 456]]), 'Details');
  const sheetPath = putFile(
    'aaxls1',
    'budget.xlsx',
    XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
  );
  const sheet = await extract(sheetPath, 'xlsx');
  assert.match(sheet.text, /hafnium/);
  assert.match(sheet.text, /456/);
  assert.equal(sheet.status, 'indexed');
  const wideBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wideBook,
    { A1: { t: 's', v: 'included' }, XFD1: { t: 's', v: 'excluded' }, '!ref': 'A1:XFD1' },
    'Wide'
  );
  const widePath = putFile(
    'aaxls2',
    'wide.xlsx',
    XLSX.write(wideBook, { type: 'buffer', bookType: 'xlsx' })
  );
  const wide = await extract(widePath, 'xlsx');
  assert.equal(wide.status, 'partial');
  assert.match(wide.text, /included/);
  assert.equal(wide.text.includes('excluded'), false, 'spreadsheet column limits must be enforced');
  const large = putFile('aalarg', 'large.txt', '');
  fs.truncateSync(large, MAX_FILE_BYTES + 1);
  assert.equal((await extract(large, 'txt')).status, 'too-large');
  assert.equal(await localFile(filesRoot, '../outside', 'txt', 'secret.txt'), null);

  const index = openIndex(mailPath);
  db.transaction(() => {
    index.transaction(() => {
      for (let i = 0; i < 1005; i++) {
        const id = `bulk-${i}`;
        const fileId = `bulkfile${i}`;
        seed(
          id,
          'a',
          [{ id: fileId, filename: 'data.txt' }],
          '',
          i === 1004 ? 'A first result' : 'Z later result'
        );
        saveResult(
          index,
          { key: id, messageId: id + '-message', accountId: 'a', fileId },
          'fixture',
          { status: 'indexed', text: 'bulkneedle' }
        );
      }
    })();
  })();
  index.close();
  subscription._options = { sortField: 'subject', sortAscending: true, unreadOnly: true };
  const durations = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    ranked = await subscription._rankedSearchResults(Parser.parse('bulkneedle'));
    durations.push(performance.now() - start);
  }
  assert.equal(ranked.total, 1005);
  assert.equal(ranked.ids.length, 1000);
  assert.equal(ranked.ids[0], 'bulk-1004', 'attachment sorting must happen before the result cap');
  console.log(
    `Synthetic indexed search: ${Math.max(...durations).toFixed(1)} ms maximum across 10 runs / 1,005 matching attachments.`
  );

  // Exercise the actual coordinator, including its IPC and native SQLite ABI.
  const coordinator = fork(path.join(root, 'app/src/services/attachment-search/worker.js'), [], {
    silent: true,
  });
  const stderr = [];
  coordinator.stderr.on('data', (data) => stderr.push(data.toString()));
  coordinator.stdout.resume();
  const childExit = new Promise((resolve) => coordinator.once('close', resolve));
  coordinator.send({ type: 'start', mailPath, filesRoot });
  const deadline = Date.now() + 10000;
  let progressed = false;
  while (Date.now() < deadline) {
    const index = openIndex(mailPath);
    const count = index.prepare('SELECT COUNT(*) n FROM Progress').get().n;
    index.close();
    if (count) {
      progressed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  coordinator.kill();
  await childExit;
  assert.equal(progressed, true, 'coordinator must advance its persistent backfill cursor');
  assert.deepEqual(stderr, [], 'coordinator must start without parser or native-module errors');
  console.log(
    'PASS: real PDF/DOCX/XLSX extraction, OCR deferral, input/time limits, persisted reuse, cross-source Boolean search, ranking, account scope, moves, and deletion.'
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (indexer && !indexer.stopped) indexer.close();
    db.close();
    // Only remove the unique temporary directory created by this script.
    assert.equal(path.dirname(temporary), os.tmpdir());
    fs.rmSync(temporary, { recursive: true, force: true });
  });
