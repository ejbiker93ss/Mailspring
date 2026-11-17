import { SearchQueryParser } from '../../../src/services/search/search-query-parser';
import LocalSearchQueryBackend, {
  compileFTSMatchQuery,
} from '../../../src/services/search/search-query-backend-local';

const SQLite = require('better-sqlite3');

describe('LocalSearchQueryBackend attachment filters', () => {
  it('matches the file extension or MIME type and combines with sender search', () => {
    const db = new SQLite(':memory:');
    try {
      db.exec(`
        CREATE TABLE Thread (id TEXT, data TEXT);
        CREATE TABLE Message (id TEXT, threadId TEXT, data TEXT);
        CREATE VIRTUAL TABLE ThreadSearch USING fts5(content_id UNINDEXED, from_, subject);
      `);
      const addThread = db.prepare('INSERT INTO Thread VALUES (?, ?)');
      const addMessage = db.prepare('INSERT INTO Message VALUES (?, ?, ?)');
      const indexThread = db.prepare('INSERT INTO ThreadSearch VALUES (?, ?, ?)');
      const rows = [
        { id: 'extension', sender: 'Dexter', files: [{ filename: 'Budget.XLSX' }] },
        {
          id: 'mime',
          sender: 'Dexter',
          files: [{ contentType: 'Application/Vnd.Ms-Excel; charset=binary' }],
        },
        { id: 'other-type', sender: 'Dexter', files: [{ filename: 'Budget.csv' }] },
        { id: 'other-sender', sender: 'Dana', files: [{ filename: 'Budget.xls' }] },
        { id: 'mention-only', sender: 'Dexter', files: [] },
        { id: 'unhydrated', sender: 'Dexter', files: [], smHasAttachments: true },
      ];
      for (const { id, sender, files, smHasAttachments } of rows) {
        addThread.run(id, '{}');
        addMessage.run(id, id, JSON.stringify({ files, smHasAttachments }));
        indexThread.run(id, sender, 'Excel file');
      }

      const search = (model: 'Thread' | 'Message', query: string) => {
        const where = new LocalSearchQueryBackend(model).compile(SearchQueryParser.parse(query));
        return db.prepare(`SELECT id FROM ${model} WHERE ${where} ORDER BY id`).pluck().all();
      };
      expect(search('Thread', 'from:dexter has:excel')).toEqual(['extension', 'mime']);
      expect(search('Thread', 'from:dexter has:spreadsheet')).toEqual([
        'extension',
        'mime',
        'other-type',
      ]);
      expect(search('Thread', 'from:dexter has:attachment')).toEqual([
        'extension',
        'mime',
        'other-type',
        'unhydrated',
      ]);
      expect(search('Message', 'has:excel')).toEqual(['extension', 'mime', 'other-sender']);
    } finally {
      db.close();
    }
  });
});

describe('LocalSearchQueryBackend relevance query', () => {
  it('preserves the from field restriction for ranking', () => {
    const ast = SearchQueryParser.parse('from:"jerian.m@msseggs.com"');

    expect(compileFTSMatchQuery(ast)).toBe('(from_ : "jerian.m@msseggs.com"*)');
  });

  it('preserves combined field restrictions for ranking', () => {
    const ast = SearchQueryParser.parse('from:jerian subject:grader');

    expect(compileFTSMatchQuery(ast)).toBe('((from_ : "jerian"*) AND (subject : "grader"*))');
  });

  it('does not create an FTS-only rank for mixed metadata searches', () => {
    const ast = SearchQueryParser.parse('from:jerian is:unread');

    expect(compileFTSMatchQuery(ast)).toBeNull();
  });
});
