/* eslint import/no-dynamic-require:0 */
/**
 * Code signing is handled separately by the Azure Trusted Signing action in
 * the GitHub workflow. This script creates an unsigned installer which is
 * then signed by the workflow after creation.
 */
const path = require('path');
const { createWindowsInstaller } = require('electron-winstaller');

const appDir = path.join(__dirname, '..');
const { version } = require(path.join(appDir, 'package.json'));

const config = {
  usePackageJson: false,
  outputDirectory: path.join(appDir, 'dist'),
  appDirectory: path.join(appDir, 'dist', 'summermail-win32-x64'),
  loadingGif: path.join(appDir, 'build', 'resources', 'win', 'loading.gif'),
  description: 'SummerMail',
  version: version,
  title: 'SummerMail',
  authors: 'Foundry 376, LLC',
  setupIcon: path.join(appDir, 'build', 'resources', 'win', 'summermail-square.ico'),
  setupExe: 'SummerMailSetup.exe',
  exe: 'summermail.exe',
  // Squirrel package identity matches the SummerMail executable and installer metadata.
  name: 'SummerMail',
};

console.log(config);
console.log('---> Starting');

createWindowsInstaller(config)
  .then(() => {
    console.log('createWindowsInstaller succeeded.');
    process.exit(0);
  })
  .catch(e => {
    console.error(`createWindowsInstaller failed: ${e.message}`);
    process.exit(1);
  });
