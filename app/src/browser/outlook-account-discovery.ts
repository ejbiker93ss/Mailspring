import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { normalizeOutlookAccounts } from '../outlook-import';

export async function discoverOutlookAccounts(platform = process.platform) {
  if (platform !== 'win32') return { supported: false, accounts: [], partial: false };
  const script = fs.readFileSync(path.join(__dirname, 'outlook-account-discovery.ps1'), 'utf8');
  return new Promise((resolve, reject) => {
    execFile(
      path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error) {
          reject(new Error('Outlook account detection could not finish.'));
          return;
        }
        try {
          const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
          resolve({
            supported: true,
            accounts: normalizeOutlookAccounts(result.accounts),
            partial: !!result.partial,
          });
        } catch {
          reject(new Error('Outlook account detection returned an unreadable response.'));
        }
      }
    );
  });
}
