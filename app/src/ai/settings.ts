import * as SecureStore from 'expo-secure-store';
import {
  Provider,
  DEFAULT_PROVIDER,
  DEFAULT_MODEL_AISTUDIO,
  DEFAULT_MODEL_OPENROUTER,
  SECURE_STORE_KEYS,
} from '../config';

export type ApiSettings = {
  provider: Provider;
  apiKey: string;
  modelId: string;
  /** Only used by the 'openai' (OpenAI-compatible) provider. */
  baseUrl: string;
};

// Where each provider keeps its key and model, and its default model
const PROVIDER_STORE: Record<
  Provider,
  { key: string; model: string; defaultModel: string }
> = {
  aistudio: {
    key: SECURE_STORE_KEYS.aiStudioKey,
    model: SECURE_STORE_KEYS.aiStudioModel,
    defaultModel: DEFAULT_MODEL_AISTUDIO,
  },
  openrouter: {
    key: SECURE_STORE_KEYS.openRouterKey,
    model: SECURE_STORE_KEYS.openRouterModel,
    defaultModel: DEFAULT_MODEL_OPENROUTER,
  },
  openai: {
    key: SECURE_STORE_KEYS.openaiKey,
    model: SECURE_STORE_KEYS.openaiModel,
    defaultModel: '', // the user must type one
  },
};

/**
 * Loads current AI provider, API key, and model ID from SecureStore.
 */
export async function getApiSettings(): Promise<ApiSettings> {
  try {
    const saved = await SecureStore.getItemAsync(SECURE_STORE_KEYS.provider);
    const provider: Provider =
      saved && saved in PROVIDER_STORE ? (saved as Provider) : DEFAULT_PROVIDER;
    const store = PROVIDER_STORE[provider];

    const apiKey = (await SecureStore.getItemAsync(store.key)) || '';
    const modelId = (await SecureStore.getItemAsync(store.model)) || store.defaultModel;
    const baseUrl = (await SecureStore.getItemAsync(SECURE_STORE_KEYS.openaiBaseUrl)) || '';

    return { provider, apiKey, modelId, baseUrl };
  } catch (err) {
    console.warn('Failed to load API settings from SecureStore', err);
    return {
      provider: DEFAULT_PROVIDER,
      apiKey: '',
      modelId: DEFAULT_MODEL_AISTUDIO,
      baseUrl: '',
    };
  }
}

/**
 * Whether these settings are enough to call the AI.
 * OpenAI-compatible servers may run without a key (e.g. a local server), so they only need a base URL.
 */
export const isConfigured = ({ provider, apiKey, baseUrl }: ApiSettings) =>
  (provider === 'openai' ? baseUrl : apiKey).trim().length > 0;

/** Checks if the active provider is ready to use. */
export async function hasApiKey(): Promise<boolean> {
  return isConfigured(await getApiSettings());
}

/**
 * Persists API settings for a provider.
 */
export async function saveApiSettings(settings: {
  provider: Provider;
  apiKey: string;
  modelId?: string;
  baseUrl?: string;
}): Promise<void> {
  const { provider, apiKey, modelId, baseUrl } = settings;
  const store = PROVIDER_STORE[provider];
  await SecureStore.setItemAsync(SECURE_STORE_KEYS.provider, provider);

  if (apiKey.trim()) {
    await SecureStore.setItemAsync(store.key, apiKey.trim());
  } else {
    await SecureStore.deleteItemAsync(store.key);
  }

  if (modelId && modelId.trim()) {
    await SecureStore.setItemAsync(store.model, modelId.trim());
  }

  if (baseUrl !== undefined && provider === 'openai') {
    if (baseUrl.trim()) {
      await SecureStore.setItemAsync(SECURE_STORE_KEYS.openaiBaseUrl, baseUrl.trim());
    } else {
      await SecureStore.deleteItemAsync(SECURE_STORE_KEYS.openaiBaseUrl);
    }
  }
}

/** Switch the active provider and return its saved key and model. */
export async function setActiveProvider(provider: Provider): Promise<ApiSettings> {
  await SecureStore.setItemAsync(SECURE_STORE_KEYS.provider, provider);
  return getApiSettings();
}

/** Change just the key, model and/or base URL of the active provider. */
export async function updateApiSettings(patch: {
  apiKey?: string;
  modelId?: string;
  baseUrl?: string;
}): Promise<void> {
  const cur = await getApiSettings();
  await saveApiSettings({
    provider: cur.provider,
    apiKey: patch.apiKey ?? cur.apiKey,
    modelId: patch.modelId ?? cur.modelId,
    baseUrl: patch.baseUrl ?? cur.baseUrl,
  });
}
