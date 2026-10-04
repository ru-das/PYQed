/**
 * Import notifications: one sticky progress notification that is updated in
 * place, then a normal "done" notification. Best-effort only: if permission is
 * denied or anything throws, the import carries on without notifications.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getPrefs } from './prefs';

const PROGRESS_ID = 'import-progress';
let ready: Promise<boolean> | null = null;

// Show notifications even while the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Create the quiet channel + ask permission once (Android 13+ needs it).
function setup(): Promise<boolean> {
  if (!ready) {
    ready = (async () => {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('import', {
          name: 'Import progress',
          importance: Notifications.AndroidImportance.LOW, // no sound on each update
        });
      }
      const { status } = await Notifications.requestPermissionsAsync();
      return status === 'granted';
    })().catch(() => false);
  }
  return ready;
}

/** Sticky progress notification; reusing the identifier replaces the old one. */
export async function showProgress(title: string, body: string) {
  try {
    if (!getPrefs().notifications || !(await setup())) return;
    await Notifications.scheduleNotificationAsync({
      identifier: PROGRESS_ID,
      content: { title, body, sticky: true, autoDismiss: false },
      trigger: Platform.OS === 'android' ? { channelId: 'import' } : null,
    });
  } catch {}
}

/** Remove the progress notification and post a normal one. */
export async function finish(title: string, body: string) {
  try {
    if (!getPrefs().notifications || !(await setup())) return;
    await Notifications.dismissNotificationAsync(PROGRESS_ID);
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  } catch {}
}
