/**
 * Drop-in for `expo-haptics` that stays silent when the user turned vibration off in Settings.
 */
import * as H from 'expo-haptics';
import { getPrefs } from './prefs';

export const NotificationFeedbackType = H.NotificationFeedbackType;
export const ImpactFeedbackStyle = H.ImpactFeedbackStyle;

export const notificationAsync: typeof H.notificationAsync = async (type) => {
  if (getPrefs().haptics) await H.notificationAsync(type);
};

export const impactAsync: typeof H.impactAsync = async (style) => {
  if (getPrefs().haptics) await H.impactAsync(style);
};
