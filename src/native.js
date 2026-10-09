// Native (iOS) integration. Every call degrades to a no-op or a browser
// equivalent on the web, so the same bundle runs in Safari and in the app.
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

export const isNative = Capacitor.isNativePlatform();
const PREFIX = 'riverguide.';

/* ---------- storage ----------
   The app keeps its state in localStorage. iOS can evict WebView storage when the
   device is low on space, so on a device every write is mirrored to native
   Preferences and restored on launch if localStorage came back empty. */
async function mirrorStorage() {
  try {
    const { keys } = await Preferences.keys();
    if (!localStorage.getItem(PREFIX + 'v1')) {
      for (const k of keys.filter((x) => x.startsWith(PREFIX))) {
        const { value } = await Preferences.get({ key: k });
        if (value != null) localStorage.setItem(k, value);
      }
    }
  } catch {}
  const set = Storage.prototype.setItem;
  const del = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k, v) {
    set.call(this, k, v);
    if (this === localStorage && String(k).startsWith(PREFIX)) Preferences.set({ key: k, value: String(v) }).catch(() => {});
  };
  Storage.prototype.removeItem = function (k) {
    del.call(this, k);
    if (this === localStorage && String(k).startsWith(PREFIX)) Preferences.remove({ key: k }).catch(() => {});
  };
}

/* ---------- haptics ---------- */
export const tap = (style = ImpactStyle.Light) => {
  if (isNative) Haptics.impact({ style }).catch(() => {});
};
export const success = () => {
  if (isNative) Haptics.notification({ type: 'SUCCESS' }).catch(() => {});
};

/* ---------- boot: run before the first render ---------- */
export async function boot() {
  if (!isNative) return;
  await mirrorStorage();
  try {
    await StatusBar.setStyle({ style: Style.Light }); // dark text on the light header
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {}
  try {
    await Keyboard.setAccessoryBarVisible({ isVisible: true });
    await Keyboard.setScroll({ isDisabled: false });
  } catch {}
  // light tick on tab bar / pill / chip taps
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target.closest && e.target.closest('.tabbtn, .tab, .chip, .btn');
      if (el && !el.disabled) tap(el.classList.contains('btn') ? ImpactStyle.Medium : ImpactStyle.Light);
    },
    true
  );
}
export const hideSplash = () => {
  if (isNative) SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
};

/* ---------- sharing / files ---------- */
export async function shareText(title, text) {
  try {
    if (isNative || navigator.share) {
      if (isNative) await Share.share({ title, text, dialogTitle: title });
      else await navigator.share({ title, text });
      return true;
    }
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch (e) {
    return false;
  }
}

// Save a JSON backup: on a device write it to the cache and open the share sheet
// (Save to Files, AirDrop, Mail...); in a browser download it.
export async function saveBackup(filename, json) {
  if (isNative) {
    try {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      const w = await Filesystem.writeFile({ path: filename, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
      await Share.share({ title: filename, url: w.uri, dialogTitle: 'Save River Guide backup' });
      return true;
    } catch {
      return false;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}

export const openUrl = (url) => {
  if (isNative) CapApp.openUrl({ url }).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank', 'noopener');
};

/* ---------- trip reminders (local notifications, opt-in) ---------- */
const NOTE_BASE = 710000; // our ids live in [NOTE_BASE, NOTE_BASE + 99999]
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 90000, 7);

export async function remindersAllowed() {
  if (!isNative) return false;
  try {
    return (await LocalNotifications.checkPermissions()).display === 'granted';
  } catch {
    return false;
  }
}
export async function askReminders() {
  if (!isNative) return false;
  try {
    return (await LocalNotifications.requestPermissions()).display === 'granted';
  } catch {
    return false;
  }
}
export async function clearReminders() {
  if (!isNative) return;
  try {
    const { notifications } = await LocalNotifications.getPending();
    const ours = notifications.filter((n) => n.id >= NOTE_BASE && n.id < NOTE_BASE + 100000);
    if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
  } catch {}
}
// trips: [{ id, name, start: 'YYYY-MM-DD' }]
export async function scheduleReminders(trips) {
  if (!isNative) return 0;
  await clearReminders();
  const now = Date.now();
  const list = [];
  for (const t of trips) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.start || '')) continue;
    const [y, m, d] = t.start.split('-').map(Number);
    const at = (daysBefore, hour, body) => {
      const when = new Date(y, m - 1, d - daysBefore, hour, 0, 0);
      if (when.getTime() > now) list.push({ id: NOTE_BASE + ((hash(t.id) * 4 + daysBefore) % 99999), title: t.name, body, schedule: { at: when, allowWhileIdle: true } });
    };
    at(7, 9, 'One week to launch. Time to finalize gear, food and the shuttle.');
    at(1, 18, 'Launch is tomorrow. Check the weather, packing list and shuttle plan.');
    at(0, 6, 'Launch day. Have a great trip!');
  }
  if (!list.length) return 0;
  try {
    await LocalNotifications.schedule({ notifications: list });
    return list.length;
  } catch {
    return 0;
  }
}
