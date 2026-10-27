const SQLite = require('better-sqlite3');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS AttachmentState (
    key TEXT PRIMARY KEY, messageId TEXT NOT NULL, accountId TEXT NOT NULL,
    fileId TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
    updatedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS AttachmentStateMessage ON AttachmentState(messageId);
  CREATE VIRTUAL TABLE IF NOT EXISTS AttachmentText USING fts5(
    text, key UNINDEXED, messageId UNINDEXED, accountId UNINDEXED, fileId UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TABLE IF NOT EXISTS Progress (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

function indexPath(mailDatabasePath) {
  return `${mailDatabasePath}.attachments.db`;
}

function openIndex(mailDatabasePath) {
  const db = new SQLite(indexPath(mailDatabasePath), { timeout: 100 });
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -2048');
    db.exec(SCHEMA);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

// All mail readers see the same index. If it cannot be opened, an empty attached
// index keeps ordinary mail search usable; extraction never runs in a reader.
function attachIndex(mailDatabase, mailDatabasePath) {
  try {
    const index = openIndex(mailDatabasePath);
    index.close();
    mailDatabase.prepare('ATTACH DATABASE ? AS attachmentSearch').run(indexPath(mailDatabasePath));
    mailDatabase.pragma('attachmentSearch.cache_size = -2048');
  } catch (error) {
    console.warn('Attachment search index unavailable:', error.code || error.name);
    mailDatabase.prepare('ATTACH DATABASE ? AS attachmentSearch').run(':memory:');
    mailDatabase.exec(
      SCHEMA.replace(/(TABLE|INDEX) IF NOT EXISTS /g, '$1 IF NOT EXISTS attachmentSearch.')
    );
  }
}

function saveResult(db, item, fingerprint, result) {
  db.transaction(() => {
    const old = db.prepare('SELECT rowid FROM AttachmentState WHERE key = ?').get(item.key);
    if (old) db.prepare('DELETE FROM AttachmentText WHERE rowid = ?').run(old.rowid);
    db.prepare(
      `INSERT INTO AttachmentState VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET fingerprint=excluded.fingerprint,
      status=excluded.status, updatedAt=excluded.updatedAt`
    ).run(
      item.key,
      item.messageId,
      item.accountId,
      item.fileId,
      fingerprint,
      result.status,
      Date.now()
    );
    if (result.text) {
      const state = db.prepare('SELECT rowid FROM AttachmentState WHERE key = ?').get(item.key);
      db.prepare(
        'INSERT INTO AttachmentText(rowid, text, key, messageId, accountId, fileId) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(state.rowid, result.text, item.key, item.messageId, item.accountId, item.fileId);
    }
  })();
}

function removeResult(db, key) {
  db.transaction(() => {
    const old = db.prepare('SELECT rowid FROM AttachmentState WHERE key = ?').get(key);
    if (old) db.prepare('DELETE FROM AttachmentText WHERE rowid = ?').run(old.rowid);
    db.prepare('DELETE FROM AttachmentState WHERE key = ?').run(key);
  })();
}

module.exports = { attachIndex, indexPath, openIndex, saveResult, removeResult };
