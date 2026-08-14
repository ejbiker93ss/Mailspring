import fs from 'fs';
import os from 'os';
import path from 'path';
import { normalizeRecentCandidates } from '../../src/services/recent-files';

describe('RecentFiles', function () {
  let testDirectory: string;

  beforeEach(function () {
    testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'recent-files-spec-'));
  });

  afterEach(function () {
    if (testDirectory && path.basename(testDirectory).startsWith('recent-files-spec-')) {
      fs.rmSync(testDirectory, { recursive: true, force: true });
    }
  });

  it('returns attachable files and removes duplicates and runtime files', async function () {
    const documentPath = path.join(testDirectory, 'report.pdf');
    const databasePath = path.join(testDirectory, 'browser.sqlite');
    fs.writeFileSync(documentPath, 'report');
    fs.writeFileSync(databasePath, 'database');

    const files = await normalizeRecentCandidates(
      [
        { path: documentPath, source: 'common' },
        { path: documentPath, source: 'local-app-data' },
        { path: databasePath, source: 'local-app-data' },
      ],
      20
    );

    expect(files.length).toBe(1);
    expect(files[0].path).toBe(path.resolve(documentPath));
  });

  it('keeps an older file referenced by the operating system recent list', async function () {
    const filePath = path.join(testDirectory, 'older-document.txt');
    fs.writeFileSync(filePath, 'still available');
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    fs.utimesSync(filePath, oldDate, oldDate);

    const withoutRecentLink = await normalizeRecentCandidates(
      [{ path: filePath, source: 'common' }],
      20
    );
    const withRecentLink = await normalizeRecentCandidates(
      [{ path: filePath, source: 'recent', recentLink: true }],
      20
    );

    expect(withoutRecentLink).toEqual([]);
    expect(withRecentLink.length).toBe(1);
  });

  it('prioritizes operating system recent items and respects the result limit', async function () {
    const indexedPath = path.join(testDirectory, 'new.pdf');
    const recentPath = path.join(testDirectory, 'recent.txt');
    fs.writeFileSync(indexedPath, 'new');
    fs.writeFileSync(recentPath, 'recent');
    const olderDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    fs.utimesSync(recentPath, olderDate, olderDate);

    const files = await normalizeRecentCandidates(
      [
        { path: indexedPath, source: 'local-app-data' },
        { path: recentPath, source: 'recent', recentLink: true },
      ],
      1
    );

    expect(files.map((file) => file.path)).toEqual([path.resolve(recentPath)]);
  });
});
