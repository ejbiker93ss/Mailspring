import { execFile } from 'child_process';
import { isWaylandSession } from './is-wayland';

const SNI_WATCHER_SERVICE = 'org.kde.StatusNotifierWatcher';
const SNI_WATCHER_PATH = '/StatusNotifierWatcher';
const SNI_PROBE_INTERVAL_MS = 500;
const DBUS_SEND_TIMEOUT_MS = 2000;
const SNI_WAIT_WAYLAND_MS = 15000;
const SNI_WAIT_X11_MS = 3000;

function isStatusNotifierHostRegistered(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'dbus-send',
      [
        '--session',
        '--print-reply',
        `--dest=${SNI_WATCHER_SERVICE}`,
        SNI_WATCHER_PATH,
        'org.freedesktop.DBus.Properties.Get',
        `string:${SNI_WATCHER_SERVICE}`,
        'string:IsStatusNotifierHostRegistered',
      ],
      { timeout: DBUS_SEND_TIMEOUT_MS },
      (error, stdout) => resolve(!error && stdout.toString().includes('boolean true'))
    );
  });
}

export function statusNotifierWaitBudgetMs(): number {
  return isWaylandSession() ? SNI_WAIT_WAYLAND_MS : SNI_WAIT_X11_MS;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Electron permanently falls back to XEmbed if the StatusNotifier host has not registered
// when Tray is constructed. Give late-starting desktop panels a bounded chance to appear.
export async function waitForStatusNotifierHost(sleep = delay): Promise<void> {
  const deadline = Date.now() + statusNotifierWaitBudgetMs();
  let ready = await isStatusNotifierHostRegistered();
  while (!ready && Date.now() < deadline) {
    await sleep(SNI_PROBE_INTERVAL_MS);
    ready = await isStatusNotifierHostRegistered();
  }
}
