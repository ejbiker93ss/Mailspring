const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Native dependencies are ignored by Git and must accompany the executable when
// preparing an isolated release checkout. Never accept an exe-only staging copy.
module.exports = function verifyWindowsMailsync(directory) {
  const required = ['mailsync.exe', 'mailcore2.dll', 'libcurl.dll', 'libxml2.dll'];
  const missing = required.filter(name => !fs.existsSync(path.join(directory, name)));
  if (missing.length) {
    throw new Error(`Incomplete mailsync runtime in ${directory}: missing ${missing.join(', ')}`);
  }
  // Restrict PATH so developer-installed dependencies cannot hide a broken bundle.
  // --help exits before accessing accounts or the mail database.
  const result = spawnSync(path.join(directory, 'mailsync.exe'), ['--help'], {
    cwd: directory,
    env: { ...process.env, PATH: path.join(process.env.SystemRoot, 'System32') },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  });
  if (result.error || result.status !== 0 || !/--mode/.test(result.stdout || '')) {
    throw new Error(`mailsync runtime verification failed in ${directory}: ${
      result.error || result.status
    } ${result.stderr || ''}`);
  }
  console.log('---> Verified mailsync starts with its packaged native dependencies');
};
