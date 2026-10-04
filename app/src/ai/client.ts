/**
 * AI client: calls Google AI Studio, OpenRouter, or any OpenAI-compatible server with the configured model.
 */

import { AI_IDLE_TIMEOUT_MS, AI_TIMEOUT_MS, OPENROUTER_BASE_URL, Provider } from '../config';

// A retry after an unreadable answer gets less time, so one bad page can't block the import for 10 minutes
const RETRY_TIMEOUT_MS = 120_000;
// If the model's hidden reasoning runs past this many characters (~10k tokens) it is stuck in a loop:
// stop the stream and let generateJSON ask again. ponytail: fixed cap, tune after seeing real thought lengths.
const MAX_THOUGHT_CHARS = 40_000;
const STUCK_THINKING = 'Model got stuck thinking';
import { validators, ValidationResult } from './validators';

/** Live signal while the model streams: its reasoning ("thinking") or the answer text so far ("writing"). */
export type StreamEvent = { phase: 'thinking' | 'writing'; text: string };

/** What a progress screen shows about a live stream: the phase, the tail of the reasoning, an item count. */
export type StreamProgress = { phase: 'thinking' | 'writing'; peek?: string; found?: number };

/** How much of the model's latest reasoning the progress screens show. */
export const PEEK_CHARS = 140;

/**
 * Turns the raw stream into StreamProgress updates (at most one per 500 ms).
 * `countRe` counts items in the partial JSON answer (e.g. /"number"\s*:/g for questions).
 */
export function streamProgress(emit: (p: StreamProgress) => void, countRe?: RegExp) {
  let last = 0;
  return (e: StreamEvent) => {
    const now = Date.now();
    if (now - last < 500) return;
    last = now;
    if (e.phase === 'thinking') {
      emit({ phase: 'thinking', peek: e.text.replace(/\s+/g, ' ').slice(-PEEK_CHARS) });
    } else {
      emit({
        phase: 'writing',
        peek: e.text.replace(/\s+/g, ' ').slice(-PEEK_CHARS),
        found: countRe ? (e.text.match(countRe) || []).length : undefined,
      });
    }
  };
}

export type GenerateJSONParams = {
  /** AI Studio only: when set, the answer is streamed and the call is only cut off if tokens stop arriving. */
  onStream?: (e: StreamEvent) => void;
  /** Sampling temperature. Default 0; the syllabus call uses 1 because 0 let Gemma loop on "final checks". */
  temperature?: number;
  /** Called just before we ask the model again because its first answer was unreadable. */
  onRetry?: () => void;
  prompt: string;
  images?: string[]; // base64 JPEG strings (without data: prefix)
  schemaName: string; // key into validators registry
  provider: Provider;
  apiKey: string;
  modelId: string;
  /** OpenAI-compatible provider only. If omitted, the saved one from Settings is used. */
  baseUrl?: string;
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

let thinkingOn = true;
/** Set from Settings. Off = ask the model to skip its reasoning (faster, less accurate). */
export function setThinking(on: boolean) {
  thinkingOn = on;
}

/** Google AI Studio generationConfig, shared by the plain and streamed calls. */
export function googleGenerationConfig(temperature: number, withJsonMime: boolean, thinking = thinkingOn) {
  const cfg: Record<string, unknown> = { temperature };
  if (withJsonMime) cfg.responseMimeType = 'application/json';
  // Gemma 4 ignores includeThoughts:false; thinkingLevel 'minimal' is what actually turns it off
  if (!thinking) cfg.thinkingConfig = { thinkingLevel: 'minimal' };
  return cfg;
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
  temperature: number = 0,
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

  const generationConfig = googleGenerationConfig(temperature, withJsonMime);

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
 * Pulls the complete `data: {...}` lines out of an SSE buffer. Returns the parsed events and
 * whatever trailing partial line is left, to be prepended to the next chunk.
 */
export function parseSSE(buffer: string): { events: any[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? ''; // last piece may be an unfinished line
  const events: any[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    try {
      events.push(JSON.parse(t.slice(5).trim()));
    } catch {
      // not JSON (keep-alive etc.): skip
    }
  }
  return { events, rest };
}

/**
 * Same request as callGoogleAIStudio, but streamed (SSE). Reports thinking/answer text as it
 * arrives and calls onActivity on every chunk so the caller can run an idle timeout.
 */
async function callGoogleAIStudioStream(
  apiKey: string,
  modelId: string,
  prompt: string,
  images: string[] = [],
  withJsonMime: boolean = true,
  signal: AbortSignal,
  onStream: (e: StreamEvent) => void,
  onActivity: () => void,
  temperature: number = 0,
): Promise<{ text: string; status: number; error?: string }> {
  // Imported lazily so this module stays free of native modules (it is unit-tested in Node).
  // expo/fetch (unlike RN's built-in fetch) can read the response body as a stream.
  const { fetch: streamFetch } = await import('expo/fetch');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelId,
  )}:streamGenerateContent?alt=sse`;

  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
    { text: prompt },
  ];
  for (const img of images) {
    parts.push({
      inline_data: { mime_type: 'image/jpeg', data: img.replace(/^data:image\/[a-zA-Z]+;base64,/, '') },
    });
  }
  const generationConfig = googleGenerationConfig(temperature, withJsonMime);

  const response = await streamFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
    signal,
  });
  const status = response.status;

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    // Error bodies on the SSE endpoint may come back as a one-element array
    const err = Array.isArray(json) ? json[0]?.error : json?.error;
    return { text: '', status, error: err?.message || `HTTP ${status}: ${response.statusText}` };
  }

  const reader = response.body?.getReader();
  if (!reader) return { text: '', status, error: 'Streaming not supported on this device' };

  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let thoughts = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity();
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSSE(buffer);
    buffer = rest;
    for (const ev of events) {
      for (const part of ev?.candidates?.[0]?.content?.parts ?? []) {
        if (!part.text) continue;
        if (part.thought) {
          thoughts += part.text;
          onStream({ phase: 'thinking', text: thoughts });
          if (thoughts.length > MAX_THOUGHT_CHARS && !answer) {
            await reader.cancel().catch(() => {});
            return { text: '', status, error: STUCK_THINKING };
          }
        } else {
          answer += part.text;
          onStream({ phase: 'writing', text: answer });
        }
      }
    }
  }

  if (!answer) return { text: '', status, error: 'Empty response candidate from model' };
  return { text: answer, status };
}

/**
 * Turns a base URL like "https://api.groq.com/openai/v1" (with or without a trailing slash,
 * or already ending in /chat/completions) into the full chat completions endpoint.
 */
export function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

/**
 * Execute request to any OpenAI-style /chat/completions server (OpenRouter, Groq, Together, ...)
 */
async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  prompt: string,
  images: string[] = [],
  withJsonMode: boolean = true,
  signal: AbortSignal,
  extraHeaders: Record<string, string> = {},
  temperature: number = 0,
): Promise<{ text: string; status: number; error?: string }> {
  const url = chatCompletionsUrl(baseUrl);

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

  const body: Record<string, unknown> = {
    model: modelId,
    messages: [{ role: 'user', content }],
    temperature,
  };
  if (withJsonMode) {
    body.response_format = { type: 'json_object' };
  }
  // OpenRouter's switch for reasoning; other OpenAI-style servers have no standard one
  if (!thinkingOn && url.startsWith(OPENROUTER_BASE_URL)) body.reasoning = { enabled: false };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Local servers (LM Studio, Ollama...) may not need a key
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
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

  // OpenAI-compatible servers can be keyless (e.g. local); they need a base URL instead
  let baseUrl = (params.baseUrl || '').trim();
  if (params.provider === 'openai' && !baseUrl) {
    // Imported lazily so this module stays free of native modules (it is unit-tested in Node)
    const { getApiSettings } = await import('./settings');
    baseUrl = (await getApiSettings()).baseUrl.trim();
  }
  if (params.provider === 'openai' && !baseUrl) {
    return {
      ok: false,
      error: 'Missing base URL',
      friendlyError: 'Add the provider\'s base URL in Settings.',
      fatal: true,
      timeMs: Date.now() - startTime,
    };
  }

  if (params.provider !== 'openai' && (!params.apiKey || !params.apiKey.trim())) {
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
    const abort = () => {
      timedOut = true;
      controller.abort();
    };
    const timer = setTimeout(abort, timeoutMs);
    // Streaming: also cut off if the model goes silent (reset on every chunk)
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const onActivity = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(abort, AI_IDLE_TIMEOUT_MS);
    };
    try {
      if (params.provider === 'aistudio' && params.onStream) {
        onActivity();
        return await callGoogleAIStudioStream(
          params.apiKey.trim(),
          params.modelId.trim(),
          promptText,
          params.images,
          withJsonMime,
          controller.signal,
          params.onStream,
          onActivity,
          params.temperature,
        );
      }
      if (params.provider === 'aistudio') {
        return await callGoogleAIStudio(
          params.apiKey.trim(),
          params.modelId.trim(),
          promptText,
          params.images,
          withJsonMime,
          controller.signal,
          params.temperature,
        );
      }
      const isOpenRouter = params.provider === 'openrouter';
      return await callOpenAICompatible(
        isOpenRouter ? OPENROUTER_BASE_URL : baseUrl,
        (params.apiKey || '').trim(),
        params.modelId.trim(),
        promptText,
        params.images,
        withJsonMime,
        controller.signal,
        isOpenRouter ? { 'X-Title': 'PYQed' } : {},
        params.temperature,
      );
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
      clearTimeout(idleTimer);
    }
  };

  // Attempt 1
  let res = await runCall(params.prompt, true);

  // If the provider rejected JSON mode (responseMimeType / response_format), retry once without it
  if (!res.text && res.error) {
    const err = res.error.toLowerCase();
    const isJsonModeError =
      params.provider === 'aistudio'
        ? err.includes('responsemimetype') || err.includes('mime_type')
        : params.provider === 'openai' &&
          (err.includes('response_format') || err.includes('json_object') || err.includes('json mode'));
    if (isJsonModeError) {
      res = await runCall(params.prompt, false);
    }
  }

  // Check HTTP errors
  // (A stuck-thinking stream is not final: it falls through to the one retry below)
  if (res.error && !res.text && res.error !== STUCK_THINKING) {
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
    params.onRetry?.();
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
