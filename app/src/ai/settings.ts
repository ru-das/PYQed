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
};

/**
 * Loads current AI provider, API key, and model ID from SecureStore.
 */
export async function getApiSettings(): Promise<ApiSettings> {
  try {
    const savedProvider = (await SecureStore.getItemAsync(
      SECURE_STORE_KEYS.provider,
    )) as Provider | null;
    const provider = savedProvider || DEFAULT_PROVIDER;

    const keyStoreKey =
      provider === 'aistudio'
        ? SECURE_STORE_KEYS.aiStudioKey
        : SECURE_STORE_KEYS.openRouterKey;
    const modelStoreKey =
      provider === 'aistudio'
        ? SECURE_STORE_KEYS.aiStudioModel
        : SECURE_STORE_KEYS.openRouterModel;

    const apiKey = (await SecureStore.getItemAsync(keyStoreKey)) || '';
    const defaultModel =
      provider === 'aistudio'
        ? DEFAULT_MODEL_AISTUDIO
        : DEFAULT_MODEL_OPENROUTER;
    const modelId = (await SecureStore.getItemAsync(modelStoreKey)) || defaultModel;

    return { provider, apiKey, modelId };
  } catch (err) {
    console.warn('Failed to load API settings from SecureStore', err);
    return {
      provider: DEFAULT_PROVIDER,
      apiKey: '',
      modelId: DEFAULT_MODEL_AISTUDIO,
    };
  }
}

/**
 * Checks if a valid API key exists for the active provider.
 */
export async function hasApiKey(): Promise<boolean> {
  const { apiKey } = await getApiSettings();
  return apiKey.trim().length > 0;
}

/**
 * Persists API settings for a provider.
 */
export async function saveApiSettings(settings: {
  provider: Provider;
  apiKey: string;
  modelId?: string;
}): Promise<void> {
  const { provider, apiKey, modelId } = settings;
  await SecureStore.setItemAsync(SECURE_STORE_KEYS.provider, provider);

  const keyStoreKey =
    provider === 'aistudio'
      ? SECURE_STORE_KEYS.aiStudioKey
      : SECURE_STORE_KEYS.openRouterKey;
  if (apiKey.trim()) {
    await SecureStore.setItemAsync(keyStoreKey, apiKey.trim());
  } else {
    await SecureStore.deleteItemAsync(keyStoreKey);
  }

  if (modelId && modelId.trim()) {
    const modelStoreKey =
      provider === 'aistudio'
        ? SECURE_STORE_KEYS.aiStudioModel
        : SECURE_STORE_KEYS.openRouterModel;
    await SecureStore.setItemAsync(modelStoreKey, modelId.trim());
  }
}

/** Switch the active provider and return its saved key and model. */
export async function setActiveProvider(provider: Provider): Promise<ApiSettings> {
  await SecureStore.setItemAsync(SECURE_STORE_KEYS.provider, provider);
  return getApiSettings();
}

/** Change just the key and/or model of the active provider. */
export async function updateApiSettings(patch: { apiKey?: string; modelId?: string }): Promise<void> {
  const cur = await getApiSettings();
  await saveApiSettings({
    provider: cur.provider,
    apiKey: patch.apiKey ?? cur.apiKey,
    modelId: patch.modelId ?? cur.modelId,
  });
}
