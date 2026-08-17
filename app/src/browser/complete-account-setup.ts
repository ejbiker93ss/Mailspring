interface SetupWindow {
  close(): void;
  focus?(): void;
  show?(): void;
  waitForLoad?(callback: () => void): void;
}

interface SetupWindowManager {
  ensureWindow(key: string): void;
  get(key: string): SetupWindow | null;
}

export function completeAccountSetup(
  windowManager: SetupWindowManager,
  windowKeys: { main: string; onboarding: string },
  platform = process.platform
) {
  windowManager.ensureWindow(windowKeys.main);
  const mainWindow = windowManager.get(windowKeys.main);
  const onboarding = windowManager.get(windowKeys.onboarding);
  if (!mainWindow || !onboarding) return;

  if (platform === 'linux' && mainWindow?.waitForLoad) {
    // On Wayland, closing the onboarding window (which holds the activation
    // context) before the main window is visible can prevent show() from
    // presenting the main window. Keep the delayed handoff on Linux.
    mainWindow.waitForLoad(() => onboarding.close());
    return;
  }

  // On Windows, the normal showWhenLoaded path waits for the renderer's
  // application-specific window:loaded event. If that event stalls, closing
  // onboarding would leave only the tray icon with a permanently hidden main
  // window. Present the already-created window synchronously before closing
  // onboarding; the renderer can finish populating the window afterward.
  if (platform === 'win32') {
    mainWindow.show?.();
    mainWindow.focus?.();
  }

  // Windows and macOS do not need the Wayland activation context.
  onboarding.close();
}
