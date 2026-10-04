/**
 * User preferences (Settings). One small JSON blob in secure-store, mirrored in memory so any
 * code can read it synchronously with getPrefs(). Native modules are imported lazily so modules
 * that read prefs (the AI client, import logic) still run in the Node unit tests.
 */
import { MAX_PAGES_PER_IMPORT, SECURE_STORE_KEYS } from './config';
import { setThinking } from './ai/client';

export type Prefs = {
  theme: 'system' | 'light' | 'dark';
  /** Let Gemma think before answering (slower, more accurate). */
  thinking: boolean;
  haptics: boolean;
  notifications: boolean;
  maxPages: number;
  /** Include page images when sharing a subject: ask each time, never, or always. */
  shareImages: 'ask' | 'without' | 'with';
};

const DEFAULTS: Prefs = {
  theme: 'system',
  thinking: true,
  haptics: true,
  notifications: true,
  maxPages: MAX_PAGES_PER_IMPORT,
  shareImages: 'ask',
};

let prefs: Prefs = DEFAULTS;
const listeners = new Set<() => void>();

export const getPrefs = () => prefs;

export function subscribePrefs(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function apply() {
  setThinking(prefs.thinking);
  const { Appearance } = await import('react-native');
  // 'unspecified' hands control back to the phone's own light/dark setting
  Appearance.setColorScheme(prefs.theme === 'system' ? 'unspecified' : prefs.theme);
}

/** Read saved prefs once at startup. Missing or broken data falls back to the defaults. */
export async function loadPrefs() {
  try {
    const SecureStore = await import('expo-secure-store');
    const raw = await SecureStore.getItemAsync(SECURE_STORE_KEYS.prefs);
    if (raw) prefs = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  await apply();
}

export async function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  listeners.forEach((fn) => fn());
  await apply();
  try {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(SECURE_STORE_KEYS.prefs, JSON.stringify(prefs));
  } catch {}
}
