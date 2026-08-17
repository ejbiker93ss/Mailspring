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
  if (platform !== 'win32' || !fileSystem.existsSync(markerPath(configDirPath))) {
    return false;
  }

  // This must run before Electron's ready event. The marker is intentionally
  // persistent because retrying the GPU on every launch recreates the same
  // Chromium cache corruption and renderer crash on affected Windows PCs.
  app.disableHardwareAcceleration();

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
