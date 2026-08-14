import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

export interface RecentLocalFile {
  path: string;
  name: string;
  directory: string;
  size: number;
  modifiedAt: number;
  source: 'recent' | 'common' | 'local-app-data' | 'system-index';
}

const MAX_ATTACHMENT_BYTES = 25 * 1000000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 2 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 15000;
const DEEP_SCAN_TIMEOUT_MS = 60000;
const MAX_COMMAND_OUTPUT = 12 * 1024 * 1024;

// Keep browser/runtime internals from overwhelming the picker while retaining
// documents, archives, media, source files and extension-less exports.
const IGNORED_EXTENSIONS = new Set([
  '.app',
  '.bin',
  '.cache',
  '.com',
  '.crdownload',
  '.db',
  '.dll',
  '.dmp',
  '.download',
  '.drv',
  '.exe',
  '.journal',
  '.lnk',
  '.lock',
  '.msi',
  '.part',
  '.pdb',
  '.so',
  '.sqlite',
  '.sqlite-shm',
  '.sqlite-wal',
  '.sys',
  '.tmp',
]);

export type RecentFileCandidate = {
  path: string;
  source: RecentLocalFile['source'];
  recentLink?: boolean;
};

function execFileWithOutput(command: string, args: string[], timeout = COMMAND_TIMEOUT_MS) {
  return new Promise<string>((resolve) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', timeout, maxBuffer: MAX_COMMAND_OUTPUT },
      (error: any, stdout: string) => resolve(stdout || error?.stdout || '')
    );
  });
}

function powershellEncodedCommand(script: string) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

async function windowsCandidates({ recent, deep }: { recent: boolean; deep: boolean }) {
  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$cutoff = (Get-Date).AddDays(-30)
$maxSize = 25000000
$includeRecent = $${recent}
$includeDeep = $${deep}
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

function Add-RecentFile([string]$filePath, [string]$source, [bool]$recentLink) {
  if ([string]::IsNullOrWhiteSpace($filePath) -or -not $seen.Add($filePath)) { return }
  $item = Get-Item -LiteralPath $filePath -Force -ErrorAction SilentlyContinue
  if ($null -eq $item -or $item.PSIsContainer -or $item.Length -le 0 -or $item.Length -gt $maxSize) { return }
  if (-not $recentLink -and $item.LastWriteTime -lt $cutoff) { return }
  [pscustomobject]@{ path = $item.FullName; source = $source; recentLink = $recentLink } |
    ConvertTo-Json -Compress
}

$recentFolder = [Environment]::GetFolderPath('Recent')
if ($includeRecent -and $recentFolder) {
  $shell = New-Object -ComObject WScript.Shell
  Get-ChildItem -LiteralPath $recentFolder -Filter '*.lnk' -File -Force |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 100 |
    ForEach-Object { Add-RecentFile $shell.CreateShortcut($_.FullName).TargetPath 'recent' $true }
}

if ($includeDeep) {
  $commonRoots = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('MyDocuments'),
    (Join-Path $HOME 'Downloads')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  foreach ($root in $commonRoots) {
    Get-ChildItem -LiteralPath $root -File -Recurse -Force |
      Where-Object { $_.LastWriteTime -ge $cutoff -and $_.Length -gt 0 -and $_.Length -le $maxSize } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 500 |
      ForEach-Object { Add-RecentFile $_.FullName 'common' $false }
  }

  if ($env:LOCALAPPDATA -and (Test-Path -LiteralPath $env:LOCALAPPDATA)) {
    Get-ChildItem -LiteralPath $env:LOCALAPPDATA -File -Recurse -Force |
      Where-Object { $_.LastWriteTime -ge $cutoff -and $_.Length -gt 0 -and $_.Length -le $maxSize } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1000 |
      ForEach-Object { Add-RecentFile $_.FullName 'local-app-data' $false }
  }
}

`;
  const output = await execFileWithOutput(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      powershellEncodedCommand(script),
    ],
    deep ? DEEP_SCAN_TIMEOUT_MS : 5000
  );
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((item) => item?.path);
}

async function macCandidates(): Promise<RecentFileCandidate[]> {
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();
  const output = await execFileWithOutput('/usr/bin/mdfind', [
    '-0',
    `kMDItemFSContentChangeDate >= $time.iso(${cutoff})`,
  ]);
  return output
    .split('\0')
    .filter(Boolean)
    .map((filePath) => ({ path: filePath, source: 'system-index' as const }));
}

function decodeFileHref(href: string) {
  try {
    return fileURLToPath(href.replace(/&amp;/g, '&'));
  } catch {
    return null;
  }
}

async function linuxRecentCandidates(): Promise<RecentFileCandidate[]> {
  const xbelPath = path.join(os.homedir(), '.local', 'share', 'recently-used.xbel');
  try {
    const xml = await fs.promises.readFile(xbelPath, 'utf8');
    const candidates: RecentFileCandidate[] = [];
    const hrefPattern = /<bookmark\b[^>]*\bhref=(?:"([^"]+)"|'([^']+)')[^>]*>/gi;
    let match: RegExpExecArray;
    while ((match = hrefPattern.exec(xml))) {
      const filePath = decodeFileHref(match[1] || match[2]);
      if (filePath) candidates.push({ path: filePath, source: 'recent', recentLink: true });
    }
    return candidates;
  } catch {
    return [];
  }
}

async function unixHomeCandidates(): Promise<RecentFileCandidate[]> {
  const ageDays = String(Math.ceil(MAX_AGE_MS / (24 * 60 * 60 * 1000)));
  const output = await execFileWithOutput(
    '/usr/bin/find',
    [
      os.homedir(),
      '-type',
      'f',
      '-mtime',
      `-${ageDays}`,
      '-size',
      '+0c',
      '-size',
      `-${MAX_ATTACHMENT_BYTES}c`,
      '-print0',
    ],
    DEEP_SCAN_TIMEOUT_MS
  );
  return output
    .split('\0')
    .filter(Boolean)
    .map((filePath) => ({ path: filePath, source: 'common' as const }));
}

async function inspectCandidate(candidate: RecentFileCandidate): Promise<RecentLocalFile | null> {
  try {
    const stats = await fs.promises.stat(candidate.path);
    const extension = path.extname(candidate.path).toLowerCase();
    const name = path.basename(candidate.path);
    if (
      !stats.isFile() ||
      stats.size <= 0 ||
      stats.size > MAX_ATTACHMENT_BYTES ||
      IGNORED_EXTENSIONS.has(extension) ||
      name.startsWith('.') ||
      (!candidate.recentLink && Date.now() - stats.mtimeMs > MAX_AGE_MS)
    )
      return null;

    return {
      path: candidate.path,
      name,
      directory: path.dirname(candidate.path),
      size: stats.size,
      modifiedAt: stats.mtimeMs,
      source: candidate.source,
    };
  } catch {
    return null;
  }
}

export async function normalizeRecentCandidates(candidates: RecentFileCandidate[], limit: number) {
  const unique = new Map<string, RecentFileCandidate>();
  candidates.forEach((candidate) => {
    const resolved = path.resolve(candidate.path);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (!unique.has(key)) unique.set(key, { ...candidate, path: resolved });
  });

  const inspected: Array<RecentLocalFile | null> = [];
  const uniqueCandidates = Array.from(unique.values());
  for (let offset = 0; offset < uniqueCandidates.length; offset += 100) {
    const batch = await Promise.all(
      uniqueCandidates.slice(offset, offset + 100).map(inspectCandidate)
    );
    inspected.push(...batch);
  }

  return inspected
    .filter(Boolean)
    .sort(
      (a, b) =>
        Number(b.source === 'recent') - Number(a.source === 'recent') || b.modifiedAt - a.modifiedAt
    )
    .slice(0, limit);
}

class RecentFilesService {
  private cached: RecentLocalFile[] = [];
  private refreshedAt = 0;
  private proactiveRefreshAt = 0;
  private pending: Promise<RecentLocalFile[]> | null = null;
  private enrichment: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  listen(callback: () => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  getCached(limit = 40) {
    return this.cached.slice(0, limit);
  }

  refreshInBackground({ limit = 80, minIntervalMs = 30000 } = {}) {
    const now = Date.now();
    if (this.pending || now - this.proactiveRefreshAt < minIntervalMs) return;
    this.proactiveRefreshAt = now;
    const previouslyCached = this.cached;
    this.pending = this.discover(limit)
      .then((discovered) =>
        normalizeRecentCandidates(
          [...discovered, ...previouslyCached].map((file) => ({
            path: file.path,
            source: file.source,
            recentLink: file.source === 'recent',
          })),
          limit
        )
      )
      .then((files) => {
        this.cached = files;
        this.refreshedAt = Date.now();
        this.listeners.forEach((listener) => listener());
        this.enrichInBackground(limit);
        return files;
      })
      .catch(() => this.cached)
      .finally(() => {
        this.pending = null;
      });
  }

  async getRecentFiles({ force = false, limit = 40 } = {}) {
    if (!force && this.cached.length && Date.now() - this.refreshedAt < CACHE_TTL_MS) {
      return this.cached.slice(0, limit);
    }
    if (this.pending) return (await this.pending).slice(0, limit);

    this.pending = this.discover(Math.max(limit, 80));
    try {
      this.cached = await this.pending;
      this.refreshedAt = Date.now();
      this.enrichInBackground(Math.max(limit, 80));
      return this.cached.slice(0, limit);
    } finally {
      this.pending = null;
    }
  }

  private async discover(limit: number) {
    let candidates: RecentFileCandidate[] = [];
    if (process.platform === 'win32') {
      candidates = await windowsCandidates({ recent: true, deep: false });
    } else if (process.platform === 'darwin') {
      candidates = await macCandidates();
    } else {
      candidates = await linuxRecentCandidates();
    }
    return normalizeRecentCandidates(candidates, limit);
  }

  private enrichInBackground(limit: number) {
    if (this.enrichment || process.platform === 'darwin') return;
    this.enrichment = (async () => {
      const candidates =
        process.platform === 'win32'
          ? await windowsCandidates({ recent: false, deep: true })
          : await unixHomeCandidates();
      const existing = this.cached.map((file) => ({ path: file.path, source: file.source }));
      const enriched = await normalizeRecentCandidates([...existing, ...candidates], limit);
      if (enriched.length) {
        this.cached = enriched;
        this.refreshedAt = Date.now();
        this.listeners.forEach((listener) => listener());
      }
    })()
      .catch(() => {})
      .finally(() => {
        this.enrichment = null;
      });
  }
}

export default new RecentFilesService();
