/**
 * App-wide configuration constants.
 */

export type Provider = 'aistudio' | 'openrouter' | 'openai';

/** Names shown in the provider dropdown. */
export const PROVIDER_LABELS: Record<Provider, string> = {
  aistudio: 'Google AI Studio',
  openrouter: 'OpenRouter',
  openai: 'OpenAI-compatible',
};

/** Where to create a free key, for the providers that have one. */
export const KEY_PAGES: Record<Exclude<Provider, 'openai'>, string> = {
  aistudio: 'https://aistudio.google.com/apikey',
  openrouter: 'https://openrouter.ai/keys',
};

/** Hint shown in the empty key field. */
export const KEY_PLACEHOLDER: Record<Provider, string> = {
  aistudio: 'Paste AI Studio Key (AIzaSy...)',
  openrouter: 'Paste OpenRouter Key (sk-or-...)',
  openai: 'Paste API key (optional for local servers)',
};

export const DEFAULT_PROVIDER: Provider = 'aistudio';

// Google AI Studio — Gemma 4 model IDs
export const DEFAULT_MODEL_AISTUDIO = 'gemma-4-26b-a4b-it';
export const ALT_MODEL_AISTUDIO = 'gemma-4-31b-it';

// OpenRouter — free Gemma 4 model
export const DEFAULT_MODEL_OPENROUTER = 'google/gemma-4-26b-a4b-it:free';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Import limits
export const MAX_PAGES_PER_IMPORT = 30;

// AI client settings
export const AI_TIMEOUT_MS = 720_000; // hard cap per call: thinking on a table page can take many minutes
export const AI_IDLE_TIMEOUT_MS = 90_000; // streaming only: give up if no tokens arrive for this long

// Image processing settings
export const IMAGE_LONG_EDGE = 1600;
export const IMAGE_JPEG_QUALITY = 0.8;

// SecureStore keys
export const SECURE_STORE_KEYS = {
  provider: 'pyqed_provider',
  aiStudioKey: 'pyqed_aistudio_key',
  openRouterKey: 'pyqed_openrouter_key',
  aiStudioModel: 'pyqed_aistudio_model',
  openRouterModel: 'pyqed_openrouter_model',
  openaiKey: 'pyqed_openai_key',
  openaiModel: 'pyqed_openai_model',
  openaiBaseUrl: 'pyqed_openai_base_url',
  prefs: 'pyqed_prefs',
} as const;
