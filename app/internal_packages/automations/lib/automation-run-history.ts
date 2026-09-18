import fs from 'fs';
import path from 'path';

export interface AutomationRunHistoryEntry {
  automationId: string;
  automationName: string;
  status: 'complete' | 'failed' | 'skipped';
  startedAt: string;
  finishedAt: string;
  targetCount: number;
  failedStep?: number;
  error?: string;
}

const filePath = path.join(AppEnv.getConfigDirPath(), 'automation-runs.json');

function readEntries(): AutomationRunHistoryEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export function recordAutomationRun(entry: AutomationRunHistoryEntry) {
  try {
    const entries = [entry, ...readEntries()].slice(0, 100);
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(entries, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    // History is diagnostic only. A filesystem problem must never turn a
    // completed mail operation into a failed one.
    console.warn('Could not record automation run history', error);
  }
}
