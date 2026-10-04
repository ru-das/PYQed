/**
 * "Keep what we have, ask for the rest." When the provider stops an answer early (RECITATION, output cap),
 * generateJSON hands back the complete part as `partial`. This loop keeps it and calls again with
 * everything kept so far, so the caller can ask for only what is missing. Pure: no React Native.
 */
import type { GenerateJSONResult } from './client';

export type ResumableOptions<T> = {
  /** One AI call. `soFar` is everything kept so far (null on the first call): build "continue after ..." from it. */
  call: (soFar: T | null) => Promise<GenerateJSONResult<T>>;
  /** Joins the kept parts into one answer. */
  merge: (parts: T[]) => T;
  /** Number of items (topics, questions, labels), to tell whether a round added anything. */
  size: (data: T) => number;
  /** Parts kept by an earlier run, e.g. before a change of settings. */
  initial?: T[];
  /** Safety cap on calls for one task. */
  maxCalls?: number;
  /** Called with the merged result just before asking for the rest. */
  onResume?: (soFar: T) => void;
};

/**
 * Returns the last result and the parts kept. If `res.ok`, `res.data` is the merge of all parts.
 * If it failed but `parts` is not empty, the caller can still use `merge(parts)` and tell the user it is partial.
 */
export async function runResumable<T>(o: ResumableOptions<T>): Promise<{ res: GenerateJSONResult<T>; parts: T[] }> {
  const parts = [...(o.initial ?? [])];
  const maxCalls = o.maxCalls ?? 6;
  let res: GenerateJSONResult<T> | undefined;

  for (let n = 0; n < maxCalls; n++) {
    const soFar = parts.length ? o.merge(parts) : null;
    res = await o.call(soFar);
    if (res.ok) {
      parts.push(res.data);
      return { res: { ...res, data: o.merge(parts) }, parts };
    }
    // Nothing usable in the stopped answer, or the user pressed Stop: give up here
    if (!res.partial) break;
    // The rest repeated what we already had: stop instead of looping
    const merged = o.merge([...parts, res.partial]);
    if (o.size(merged) <= (soFar ? o.size(soFar) : 0)) break;
    parts.push(res.partial);
    o.onResume?.(merged);
  }
  return { res: res as GenerateJSONResult<T>, parts };
}
