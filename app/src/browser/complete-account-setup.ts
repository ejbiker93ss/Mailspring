interface SetupWindow {
  close(): void;
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
  if (!onboarding) return;

  if (platform === 'linux' && mainWindow?.waitForLoad) {
    // On Wayland, closing the onboarding window (which holds the activation
    // context) before the main window is visible can prevent show() from
    // presenting the main window. Keep the delayed handoff on Linux.
    mainWindow.waitForLoad(() => onboarding.close());
    return;
  }

  // Windows and macOS do not need the Wayland activation context. Closing
  // immediately also prevents onboarding from becoming stuck if the main
  // window's renderer never emits the application-specific window:loaded event.
  onboarding.close();
}
