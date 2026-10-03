/**
 * AI client: calls Google AI Studio or OpenRouter with the configured model.
 */

import { AI_TIMEOUT_MS, Provider } from '../config';

// A retry after an unreadable answer gets less time, so one bad page can't block the import for 10 minutes
const RETRY_TIMEOUT_MS = 120_000;
import { validators, ValidationResult } from './validators';

export type GenerateJSONParams = {
  prompt: string;
  images?: string[]; // base64 JPEG strings (without data: prefix)
  schemaName: string; // key into validators registry
  provider: Provider;
  apiKey: string;
  modelId: string;
};

export type GenerateJSONResult<T = unknown> =
  | {
      ok: true;
      data: T;
      rawText: string;
      timeMs: number;
    }
  | {
      ok: false;
      error: string;
      friendlyError: string;
      rawText?: string;
      /** True for problems retrying the next page won't fix (bad key, rate limit, offline, timeout). */
      fatal: boolean;
      timeMs: number;
    };

/**
 * Strips thinking blocks and extracts the outermost JSON object string.
 */
export function extractJSON(rawText: string): string | null {
  if (!rawText) return null;

  // Remove <think>...</think> tags and markdown thinking blocks
  let cleaned = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```thinking[\s\S]*?```/gi, '')
    .trim();

  // Find the first { and the last }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return cleaned.substring(firstBrace, lastBrace + 1);
}

/**
 * Maps HTTP status codes or error types to user-friendly messages.
 */
function toFriendlyError(
  status: number | null,
  rawMessage: string,
  elapsedMs = 0,
): { error: string; friendlyError: string; fatal: boolean } {
  if (status === 401 || status === 403) {
    return {
      error: `Auth error (${status}): ${rawMessage}`,
      friendlyError: "Your API key doesn't work. Check it in Settings.",
      fatal: true,
    };
  }
  if (status === 429) {
    return {
      error: `Rate limited (429): ${rawMessage}`,
      friendlyError:
        'Free daily limit reached. Your progress is saved; try again later.',
      fatal: true,
    };
  }
  if (rawMessage.includes('timed out') || rawMessage.includes('timeout')) {
    return {
      error: `Timeout: ${rawMessage}`,
      friendlyError:
        'The request took too long. The model may be busy on the free tier — try again.',
      fatal: true,
    };
  }
  if (status === null || rawMessage.includes('Network') || rawMessage.includes('Failed to fetch')) {
    // A fetch that dies after a long wait was cut off mid-request, not offline
    if (elapsedMs > 5000) {
      return {
        error: `Connection dropped after ${Math.round(elapsedMs / 1000)}s: ${rawMessage}`,
        friendlyError: `The connection dropped while AI was reading (after ${Math.round(
          elapsedMs / 1000,
        )}s). Try again.`,
        fatal: true,
      };
    }
    return {
      error: `Network error: ${rawMessage}`,
      friendlyError: 'No internet. Your subjects and practice still work offline.',
      fatal: true,
    };
  }
  return {
    error: `Error (${status}): ${rawMessage}`,
    friendlyError: `Something went wrong (${status || 'network'}). Tap to retry.`,
    fatal: false,
  };
}

/**
 * Execute request to Google AI Studio
 */
async function callGoogleAIStudio(
  apiKey: string,
  modelId: string,
  prompt: string,
  images: string[] = [],
  withJsonMime: boolean = true,
  signal: AbortSignal,
): Promise<{ text: string; status: number; error?: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelId,
  )}:generateContent`;

  const parts: Array<
    | { text: string }
    | { inline_data: { mime_type: string; data: string } }
  > = [{ text: prompt }];

  for (const imgBase64 of images) {
    // Strip data:image/...;base64, prefix if present
    const cleanBase64 = imgBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: cleanBase64,
      },
    });
  }

  const generationConfig: Record<string, unknown> = {
    temperature: 0,
  };
  if (withJsonMime) {
    generationConfig.responseMimeType = 'application/json';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig,
    }),
    signal,
  });

  const status = response.status;
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg =
      json?.error?.message || `HTTP ${status}: ${response.statusText}`;
    return { text: '', status, error: errorMsg };
  }

  // Parse candidate content, ignoring parts flagged as thoughts
  const candidate = json?.candidates?.[0];
  const responseParts = candidate?.content?.parts;

  if (!Array.isArray(responseParts) || responseParts.length === 0) {
    return { text: '', status, error: 'Empty response candidate from model' };
  }

  const text = responseParts
    .filter((part: any) => !part.thought)
    .map((part: any) => part.text || '')
    .join('');

  return { text, status };
}

/**
 * Execute request to OpenRouter
 */
async function callOpenRouter(
  apiKey: string,
  modelId: string,
  prompt: string,
  images: string[] = [],
  signal: AbortSignal,
): Promise<{ text: string; status: number; error?: string }> {
  const url = 'https://openrouter.ai/api/v1/chat/completions';

  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: prompt }];

  for (const imgBase64 of images) {
    const dataUrl = imgBase64.startsWith('data:')
      ? imgBase64
      : `data:image/jpeg;base64,${imgBase64}`;
    content.push({
      type: 'image_url',
      image_url: { url: dataUrl },
    });
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Title': 'PYQed',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content }],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
    signal,
  });

  const status = response.status;
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg =
      json?.error?.message || `HTTP ${status}: ${response.statusText}`;
    return { text: '', status, error: errorMsg };
  }

  const text = json?.choices?.[0]?.message?.content || '';
  return { text, status };
}

/**
 * Main generateJSON function
 */
export async function generateJSON<T = unknown>(
  params: GenerateJSONParams,
): Promise<GenerateJSONResult<T>> {
  const startTime = Date.now();
  const validator = validators[params.schemaName];

  if (!validator) {
    return {
      ok: false,
      error: `Validator for schema "${params.schemaName}" not found`,
      friendlyError: 'Internal error: missing response validator.',
      fatal: true,
      timeMs: Date.now() - startTime,
    };
  }

  if (!params.apiKey || !params.apiKey.trim()) {
    return {
      ok: false,
      error: 'Missing API key',
      friendlyError: "Your API key doesn't work. Check it in Settings.",
      fatal: true,
      timeMs: Date.now() - startTime,
    };
  }

  const runCall = async (
    promptText: string,
    withJsonMime: boolean,
    timeoutMs: number = AI_TIMEOUT_MS,
  ): Promise<{ text: string; status: number; error?: string }> => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      if (params.provider === 'aistudio') {
        return await callGoogleAIStudio(
          params.apiKey.trim(),
          params.modelId.trim(),
          promptText,
          params.images,
          withJsonMime,
          controller.signal,
        );
      } else {
        return await callOpenRouter(
          params.apiKey.trim(),
          params.modelId.trim(),
          promptText,
          params.images,
          controller.signal,
        );
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      // RN may surface our abort as a generic network error, so trust the flag
      if (timedOut || err?.name === 'AbortError' || msg.toLowerCase().includes('abort')) {
        return {
          text: '',
          status: 0,
          error: 'Request timed out. The model may be busy; try again.',
        };
      }
      return { text: '', status: 0, error: msg };
    } finally {
      clearTimeout(timer);
    }
  };

  // Attempt 1
  let res = await runCall(params.prompt, true);

  // If AI Studio failed because of responseMimeType, retry once without it
  if (!res.text && res.error && params.provider === 'aistudio') {
    const isMimeError =
      res.error.toLowerCase().includes('responsemimetype') ||
      res.error.toLowerCase().includes('mime_type');
    if (isMimeError) {
      res = await runCall(params.prompt, false);
    }
  }

  // Check HTTP errors
  if (res.error && !res.text) {
    const friendly = toFriendlyError(
      res.status || null,
      res.error,
      Date.now() - startTime,
    );
    return {
      ok: false,
      error: friendly.error,
      friendlyError: friendly.friendlyError,
      fatal: friendly.fatal,
      timeMs: Date.now() - startTime,
    };
  }

  // Extract JSON from response text
  let rawJson = extractJSON(res.text);
  let parsed: unknown = null;
  let validation: ValidationResult<T> = { ok: false, error: 'JSON not extracted' };

  if (rawJson) {
    try {
      parsed = JSON.parse(rawJson);
      validation = validator(parsed);
    } catch (e: any) {
      validation = { ok: false, error: `JSON parse error: ${e.message}` };
    }
  }

  // If extraction or validation failed, retry ONCE with explicit instructions
  if (!validation.ok) {
    const retryPrompt = `${params.prompt}\n\nIMPORTANT: Your previous response was invalid. Return ONLY a single raw valid JSON object without markdown fences, thoughts, or explanations.`;
    const retryRes = await runCall(retryPrompt, false, RETRY_TIMEOUT_MS);

    if (retryRes.text) {
      res = retryRes;
      rawJson = extractJSON(retryRes.text);
      if (rawJson) {
        try {
          parsed = JSON.parse(rawJson);
          validation = validator(parsed);
        } catch (e: any) {
          validation = { ok: false, error: `Retry JSON parse error: ${e.message}` };
        }
      }
    }
  }

  const totalTime = Date.now() - startTime;

  if (validation.ok) {
    return {
      ok: true,
      data: validation.data,
      rawText: res.text,
      timeMs: totalTime,
    };
  }

  return {
    ok: false,
    error: validation.error,
    friendlyError: "Couldn't read this page. Tap Retry or add questions manually.",
    fatal: false,
    rawText: res.text,
    timeMs: totalTime,
  };
}
