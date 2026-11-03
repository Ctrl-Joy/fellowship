/** Per-device notification settings (sound and desktop alerts). Stored in localStorage; never required. */

const KEY_SOUND = 'fs:notif:sound';
const KEY_DESKTOP = 'fs:notif:desktop';

function read(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function write(key: string, on: boolean) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* private mode: keep the in-memory value only */ }
}

export const deviceSettings = {
  soundOn: () => read(KEY_SOUND),
  setSoundOn: (on: boolean) => write(KEY_SOUND, on),
  desktopOn: () => read(KEY_DESKTOP),
  setDesktopOn: (on: boolean) => write(KEY_DESKTOP, on),
};

export function desktopPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}
