import path from 'path';
import crypto from 'crypto';
import Sqlite3 from 'better-sqlite3';

export interface AiSummaryScope {
  username: string;
  mailbox: string;
}

export interface StoredThreadSummary {
  summary: string;
  messageCount: number;
  updatedAt: string;
}

export interface StoredQuotedSummary {
  summary: string;
  updatedAt: string;
}

export function normalizeSummaryText(value: string) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

export function quotedSummaryContentHash(quoteText: string) {
  return crypto.createHash('sha256').update(normalizeSummaryText(quoteText)).digest('hex');
}

function normalizedScope(scope: AiSummaryScope) {
  return {
    username: (scope.username || '').trim().toLowerCase(),
    mailbox: (scope.mailbox || '').trim().toLowerCase(),
  };
}

export class AiSummaryStore {
  private _db: Sqlite3.Database;

  constructor(databasePath: string) {
    this._db = new Sqlite3(databasePath, { timeout: 10000 });
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('synchronous = NORMAL');
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS mb_thread_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        mailbox TEXT NOT NULL,
        thread_key TEXT NOT NULL,
        subject TEXT,
        summary TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (username, mailbox, thread_key)
      );
      CREATE TABLE IF NOT EXISTS mb_quoted_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        mailbox TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (username, mailbox, content_hash)
      );
    `);
  }

  getThreadSummary(scope: AiSummaryScope, threadKey: string): StoredThreadSummary | null {
    const { username, mailbox } = normalizedScope(scope);
    try {
      const row = this._db
        .prepare(
          `SELECT summary, message_count AS messageCount, updated_at AS updatedAt
           FROM mb_thread_summaries
           WHERE username = ? AND mailbox = ? AND thread_key = ?`
        )
        .get(username, mailbox, threadKey) as StoredThreadSummary | undefined;
      return row || null;
    } catch (error) {
      AppEnv.reportError(error);
      return null;
    }
  }

  putThreadSummary(
    scope: AiSummaryScope,
    threadKey: string,
    subject: string,
    summary: string,
    messageCount: number
  ): StoredThreadSummary {
    const { username, mailbox } = normalizedScope(scope);
    const updatedAt = new Date().toISOString();
    this._db
      .prepare(
        `INSERT INTO mb_thread_summaries
          (username, mailbox, thread_key, subject, summary, message_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(username, mailbox, thread_key) DO UPDATE SET
           subject = excluded.subject,
           summary = excluded.summary,
           message_count = excluded.message_count,
           updated_at = excluded.updated_at`
      )
      .run(
        username,
        mailbox,
        threadKey,
        subject || null,
        summary,
        messageCount,
        updatedAt,
        updatedAt
      );
    return { summary, messageCount, updatedAt };
  }

  getQuotedSummary(scope: AiSummaryScope, quoteText: string): StoredQuotedSummary | null {
    const { username, mailbox } = normalizedScope(scope);
    const contentHash = quotedSummaryContentHash(quoteText);
    try {
      const row = this._db
        .prepare(
          `SELECT summary, updated_at AS updatedAt
           FROM mb_quoted_summaries
           WHERE username = ? AND mailbox = ? AND content_hash = ?`
        )
        .get(username, mailbox, contentHash) as StoredQuotedSummary | undefined;
      return row || null;
    } catch (error) {
      AppEnv.reportError(error);
      return null;
    }
  }

  putQuotedSummary(scope: AiSummaryScope, quoteText: string, summary: string): StoredQuotedSummary {
    const { username, mailbox } = normalizedScope(scope);
    const contentHash = quotedSummaryContentHash(quoteText);
    const updatedAt = new Date().toISOString();
    this._db
      .prepare(
        `INSERT INTO mb_quoted_summaries
          (username, mailbox, content_hash, summary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(username, mailbox, content_hash) DO UPDATE SET
           summary = excluded.summary,
           updated_at = excluded.updated_at`
      )
      .run(username, mailbox, contentHash, summary, updatedAt, updatedAt);
    return { summary, updatedAt };
  }

  close() {
    this._db.close();
  }
}

let defaultStore: AiSummaryStore | null = null;

export function getAiSummaryStore() {
  if (!defaultStore) {
    defaultStore = new AiSummaryStore(path.join(AppEnv.getConfigDirPath(), 'ai-summaries.db'));
  }
  return defaultStore;
}
