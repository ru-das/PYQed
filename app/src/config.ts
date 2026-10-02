/**
 * App-wide configuration constants. AGENTS.md §12.
 */

export type Provider = 'aistudio' | 'openrouter';

export const DEFAULT_PROVIDER: Provider = 'aistudio';

// Google AI Studio — Gemma 4 model IDs (AGENTS.md §7)
export const DEFAULT_MODEL_AISTUDIO = 'gemma-4-26b-a4b-it';
export const ALT_MODEL_AISTUDIO = 'gemma-4-31b-it';

// OpenRouter — free Gemma 4 model (AGENTS.md §7)
export const DEFAULT_MODEL_OPENROUTER = 'google/gemma-4-26b-a4b-it:free';
export const ALT_MODEL_OPENROUTER = 'google/gemma-4-31b-it:free';

// Import limits
export const MAX_PAGES_PER_IMPORT = 30;

// AI client settings
export const AI_TIMEOUT_MS = 120_000;

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
} as const;
