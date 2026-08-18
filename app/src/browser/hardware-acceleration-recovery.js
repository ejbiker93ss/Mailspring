const fs = require('fs');
const path = require('path');

const MARKER_FILENAME = 'disable-hardware-acceleration';
const CACHE_CLEARED_FILENAME = 'software-rendering-cache-cleared';
let recoveryStarted = false;

const markerPath = (configDirPath) => path.join(configDirPath, MARKER_FILENAME);

const isPrimaryWindowForRecovery = ({ mainWindow, windowType }) =>
  !!mainWindow || windowType === 'onboarding';

const shouldRecoverFromEarlyRendererCrash = ({ platform, primaryWindow, loaded, reason }) =>
  platform === 'win32' && primaryWindow && !loaded && !['clean-exit', 'killed'].includes(reason);

const preparePersistentSoftwareRendering = (
  app,
  configDirPath,
  platform = process.platform,
  fileSystem = fs
) => {
  if (platform !== 'win32') {
    return false;
  }

  // This must run before Electron's ready event. Some Windows GPU/driver
  // combinations leave Chromium's renderer alive but permanently white, so
  // render-process-gone is never emitted and reactive recovery cannot run.
  // Software rendering is the reliable default for this desktop mail client.
  app.disableHardwareAcceleration();
  // Match the command-line workaround proven on affected Windows machines.
  // disableHardwareAcceleration() alone can still leave Chromium attempting
  // to initialize a GPU process that hangs without terminating the renderer.
  app.commandLine.appendSwitch('disable-gpu');

  if (!fileSystem.existsSync(markerPath(configDirPath))) {
    return true;
  }

  const cacheClearedPath = path.join(configDirPath, CACHE_CLEARED_FILENAME);
  if (!fileSystem.existsSync(cacheClearedPath)) {
    for (const cacheName of ['GPUCache', 'Code Cache', 'Cache']) {
      try {
        fileSystem.rmSync(path.join(configDirPath, cacheName), { recursive: true, force: true });
      } catch (error) {
        // Cache cleanup is best-effort. Software rendering is still the critical
        // recovery step and will prevent new GPU cache entries from being used.
        console.warn(`Unable to clear ${cacheName} during GPU recovery: ${error.message}`);
      }
    }
    fileSystem.writeFileSync(cacheClearedPath, `${new Date().toISOString()}\n`);
  }
  return true;
};

const attemptEarlyRendererCrashRecovery = ({
  app,
  configDirPath,
  loaded,
  primaryWindow,
  platform = process.platform,
  reason,
  fileSystem = fs,
}) => {
  if (
    recoveryStarted ||
    !shouldRecoverFromEarlyRendererCrash({ platform, primaryWindow, loaded, reason })
  ) {
    return false;
  }

  recoveryStarted = true;
  fileSystem.writeFileSync(
    markerPath(configDirPath),
    `Renderer startup failure (${reason}) at ${new Date().toISOString()}\n`
  );
  app.relaunch();
  app.exit(0);
  return true;
};

const resetRecoveryStateForTests = () => {
  recoveryStarted = false;
};

module.exports = {
  attemptEarlyRendererCrashRecovery,
  isPrimaryWindowForRecovery,
  markerPath,
  preparePersistentSoftwareRendering,
  resetRecoveryStateForTests,
  shouldRecoverFromEarlyRendererCrash,
};
