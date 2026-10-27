// This process owns the attachment index, never writes the mail database, and
// runs at most one short-lived extraction subprocess at a time.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { fork } = require('child_process');
const SQLite = require('better-sqlite3');
const { openIndex, saveResult, removeResult } = require('./index-db');
const { supported, MAX_FILE_BYTES, VERSION } = require('./extractor');

const PAGE_SIZE = 50;
const BETWEEN_FILES_MS = 1500;
const RESCAN_MS = 5 * 60 * 1000;
const EXTRACTION_TIMEOUT_MS = 15000;
const MAX_PENDING_MESSAGES = 200;

function lowerPriority() {
  try {
    os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch (error) {
    console.warn('Attachment worker priority unavailable:', error.code);
  }
}

function extractInProcess(item, timeout = EXTRACTION_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const child = fork(path.join(__dirname, 'extractor.js'), [], {
      silent: true,
      windowsHide: true,
      execArgv: ['--max-old-space-size=128'],
    });
    // Drain output without forwarding document details into application logs.
    child.stdout.resume();
    child.stderr.resume();
    let result = { status: 'failed', text: '' };
    const timer = setTimeout(() => {
      result = { status: 'timed-out', text: '' };
      child.kill();
    }, timeout);
    child.once('message', (value) => {
      if (value && typeof value.text === 'string' && typeof value.status === 'string')
        result = value;
    });
    child.once('error', () => child.kill());
    child.once('close', () => {
      clearTimeout(timer);
      resolve(result);
    });
    child.send({ filePath: item.filePath, extension: item.extension }, (error) => {
      if (error) child.kill();
    });
  });
}

async function localFile(filesRoot, fileId, extension, filename) {
  // File IDs are path components supplied by sync, not arbitrary file paths.
  if (!/^[a-z0-9_-]+$/i.test(fileId)) return null;
  const id = fileId.toLowerCase();
  const directory = path.join(filesRoot, id.slice(0, 2), id.slice(2, 4), id);
  try {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    const files = entries.filter(
      (entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === `.${extension}`
    );
    const file =
      files.find((entry) => entry.name === filename) || (files.length === 1 ? files[0] : null);
    if (!file) return null;
    const filePath = await fs.promises.realpath(path.join(directory, file.name));
    const root = await fs.promises.realpath(filesRoot);
    if (!filePath.startsWith(root + path.sep)) return null;
    const stat = await fs.promises.stat(filePath);
    return { filePath, stat };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

class AttachmentIndexer {
  constructor(mailPath, filesRoot, extract = extractInProcess) {
    this.mail = new SQLite(mailPath, { readonly: true, timeout: 100 });
    this.mail.pragma('cache_size = -2048');
    this.index = openIndex(mailPath);
    this.filesRoot = filesRoot;
    this.extract = extract;
    this.pending = new Set();
    this.stopped = false;
    this.pauseUntil = 0;
    this.cursor =
      this.index.prepare("SELECT value FROM Progress WHERE key = 'cursor'").get()?.value || '';
  }

  enqueue(ids) {
    for (const id of ids) {
      if (this.pending.size >= MAX_PENDING_MESSAGES) break;
      if (typeof id === 'string') this.pending.add(id);
    }
  }

  async yieldToSearch() {
    while (!this.stopped && Date.now() < this.pauseUntil) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1000, this.pauseUntil - Date.now()))
      );
    }
  }

  async indexMessage(row) {
    const previous = this.index
      .prepare('SELECT key, fileId FROM AttachmentState WHERE messageId = ?')
      .all(row.id);
    const files = row.data ? JSON.parse(row.data).files || [] : [];
    const fileIds = new Set(files.map((file) => file.id));
    for (const old of previous) {
      if (!fileIds.has(old.fileId)) removeResult(this.index, old.key);
    }
    for (const file of files) {
      await this.yieldToSearch();
      if (this.stopped || !row.accountId || !file.id) continue;
      const item = {
        key: JSON.stringify([row.accountId, row.id, file.id]),
        messageId: row.id,
        accountId: row.accountId,
        fileId: file.id,
      };
      const extension = path
        .extname(file.filename || '')
        .slice(1)
        .toLowerCase();
      // Images are deliberately skipped: OCR is not part of lightweight search.
      if (!supported(extension)) continue;
      const local = await localFile(this.filesRoot, file.id, extension, file.filename);
      const old = this.index
        .prepare('SELECT fingerprint, status FROM AttachmentState WHERE key = ?')
        .get(item.key);
      if (!local) {
        if (!old)
          saveResult(this.index, item, `${VERSION}:missing`, {
            status: 'pending-download',
            text: '',
          });
        continue;
      }
      if (Number.isFinite(file.size) && local.stat.size < file.size) continue;
      const fingerprint = `${VERSION}:${local.stat.size}:${local.stat.mtimeMs}`;
      if (old?.fingerprint === fingerprint && old.status !== 'extracting') continue;
      if (local.stat.size > MAX_FILE_BYTES) {
        saveResult(this.index, item, fingerprint, { status: 'too-large', text: '' });
        continue;
      }
      // An interrupted extraction is retried on restart. Terminal errors remain
      // recorded until the file or extractor changes, avoiding endless retries.
      saveResult(this.index, item, fingerprint, { status: 'extracting', text: '' });
      const result = await this.extract({ ...item, filePath: local.filePath, extension });
      const after = await fs.promises.stat(local.filePath).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      // Download completion can replace a file while it is being extracted.
      if (!after || after.size !== local.stat.size || after.mtimeMs !== local.stat.mtimeMs) {
        removeResult(this.index, item.key);
        continue;
      }
      saveResult(this.index, item, fingerprint, result);
      await new Promise((resolve) => setTimeout(resolve, BETWEEN_FILES_MS));
    }
  }

  async step() {
    await this.yieldToSearch();
    if (this.pending.size) {
      const id = this.pending.values().next().value;
      this.pending.delete(id);
      const row = this.mail.prepare('SELECT id, accountId, data FROM Message WHERE id = ?').get(id);
      await this.indexMessage(row || { id, data: null });
      return true;
    }
    const rows = this.mail
      .prepare('SELECT id, accountId, data FROM Message WHERE id > ? ORDER BY id LIMIT ?')
      .all(this.cursor, PAGE_SIZE);
    for (const row of rows) {
      if (this.stopped) return false;
      await this.indexMessage(row);
      this.cursor = row.id;
    }
    if (rows.length) {
      this.index.prepare("INSERT OR REPLACE INTO Progress VALUES ('cursor', ?)").run(this.cursor);
      return true;
    }
    // Bound cleanup too. Search also joins current Message/files, so stale text
    // cannot produce hits while this incremental cleanup catches up.
    const cleanupCursor =
      this.index.prepare("SELECT value FROM Progress WHERE key = 'cleanup'").get()?.value || '';
    const states = this.index
      .prepare('SELECT key, messageId FROM AttachmentState WHERE key > ? ORDER BY key LIMIT ?')
      .all(cleanupCursor, PAGE_SIZE);
    for (const state of states) {
      if (!this.mail.prepare('SELECT 1 FROM Message WHERE id = ?').get(state.messageId))
        removeResult(this.index, state.key);
    }
    this.index
      .prepare("INSERT OR REPLACE INTO Progress VALUES ('cleanup', ?)")
      .run(states.length ? states[states.length - 1].key : '');
    if (states.length) return true;
    this.cursor = '';
    this.index.prepare("INSERT OR REPLACE INTO Progress VALUES ('cursor', '')").run();
    return false;
  }

  close() {
    this.stopped = true;
    this.mail.close();
    this.index.close();
  }
}

if (require.main === module) {
  lowerPriority();
  let indexer;
  let timer;
  let running = false;
  const tick = async () => {
    if (!indexer || running) return;
    running = true;
    let more = false;
    try {
      more = await indexer.step();
    } catch (error) {
      console.warn('Attachment indexing deferred:', error.code || error.name);
    } finally {
      running = false;
      clearTimeout(timer);
      timer = setTimeout(tick, more || indexer.pending.size ? BETWEEN_FILES_MS : RESCAN_MS);
    }
  };
  process.on('message', (message) => {
    if (message.type === 'start' && !indexer) {
      try {
        indexer = new AttachmentIndexer(message.mailPath, message.filesRoot);
        tick();
      } catch (error) {
        console.warn('Attachment indexer unavailable:', error.code || error.name);
        process.exit(1);
      }
    } else if (message.type === 'messages' && indexer) {
      indexer.enqueue(message.ids || []);
      // Let foreground message changes and incoming sync writes settle first.
      indexer.pauseUntil = Math.max(indexer.pauseUntil, Date.now() + 3000);
      if (!running) {
        clearTimeout(timer);
        timer = setTimeout(tick, BETWEEN_FILES_MS);
      }
    } else if (message.type === 'pause' && indexer) {
      indexer.pauseUntil = Date.now() + 10000;
    }
  });
  process.on('disconnect', () => process.exit(0));
}

module.exports = { AttachmentIndexer, localFile, extractInProcess };
