/**
 * Syllabus Import orchestrator.
 * Supports PDF (via PdfWorker), photos, or pasted text.
 * Pages go to the model in chunks of up to 6 (one call for a short syllabus). Each chunk after the first is
 * told which subject/unit the previous one ended in, then the chunks are merged by subject name.
 * Pages or chunks that fail are reported in `notice`, never dropped silently.
 */

import { Provider } from '../config';
import { devLog, generateJSON, GenerateJSONResult, streamProgress, StreamProgress } from './client';
import { runResumable } from './resume';
import { DetailsMode, syllabusToStructurePrompt } from './prompts';
import {
  RawSyllabusSubject,
  SyllabusStructureResponse,
} from './validators';
import type { PdfWorkerHandle } from '../pdf/PdfWorker';
import { processPdf, ProcessPdfProgress } from '../pdf/processPdf';
import { countTopics, lastSyllabusPosition, mergeSyllabusSubjects, SyllabusPosition } from '../logic/syllabus';

export { mergeSyllabusSubjects };

export type SyllabusSource =
  | { type: 'pdf'; fileUri: string }
  | { type: 'photos'; imageBase64s: string[] }
  | { type: 'text'; text: string };

export type SyllabusImportProgress = {
  stage: 'reading' | 'analyzing' | 'retrying' | 'merging';
  current: number;
  total: number;
  message: string;
  /** Set while the rest of a stopped answer is being asked for: the topic (or unit) it continues after */
  after?: string;
  /** Live signal from the model while it works on this call (see StreamProgress) */
  live?: StreamProgress<{ units: number; topics: number }>;
};

export type SyllabusImportResult =
  | { ok: true; subjects: RawSyllabusSubject[]; notice?: string }
  | { ok: false; error: string; friendlyError: string };

export type ImportSyllabusOptions = {
  source: SyllabusSource;
  provider: Provider;
  apiKey: string;
  modelId: string;
  pdfWorker?: PdfWorkerHandle;
  onProgress?: (progress: SyllabusImportProgress) => void;
  /** Abort to stop the import (the user pressed Stop). */
  signal?: AbortSignal;
};

/** Pages sent to the model per call. */
// ponytail: a full-size render lets Gemma copy the syllabus exactly and Google's recitation filter blocks it;
// ~1000 px matches a cropped phone screenshot, which passed. Raise it if small table text is misread.
const SYLLABUS_PDF_LONG_EDGE = 1000;
const CHUNK_PAGES = 3; // 6 pages of a clean PDF render got blocked as RECITATION; photos of the same pages were fine
const FALLBACK_NOTICE: Record<'summary' | 'none', string> = {
  summary: 'Google blocked copying the syllabus word for word, so topic details were summarised in the AI\'s own words. Names are exact.',
  none: 'Google kept blocking the syllabus text, so some topics have no details. Names are exact.',
};

const count = (text: string, re: RegExp) => (text.match(re) || []).length;

/** Units and topics in the partial JSON answer. Every unit has a "topics" key and every subject a
 *  "units" key, so topics = all "name" keys minus the subject and unit names. */
function countFound(text: string) {
  const units = count(text, /"topics"\s*:/g);
  const subjects = count(text, /"units"\s*:/g);
  return { units, topics: Math.max(0, count(text, /"name"\s*:/g) - units - subjects) };
}

type SyllabusCall = Parameters<typeof generateJSON<SyllabusStructureResponse>>[0];
type SyllabusResult = GenerateJSONResult<SyllabusStructureResponse> & { partly?: boolean };

const mergeParts = (parts: SyllabusStructureResponse[]): SyllabusStructureResponse => ({
  subjects: mergeSyllabusSubjects(parts.map((p) => p.subjects)),
});

/**
 * One syllabus call. If the provider stops the answer midway (output cap, or its recitation filter because
 * the answer copied public text word for word), the complete part is kept and Gemma is asked only for
 * what comes after it. If the recitation filter still blocks, ask again with details summarised, then
 * with no details. `onFallback` tells the caller which fallback ran so the user hears about it.
 * `partly` = the call ended for good but part of the pages was read.
 */
async function callSyllabus(
  promptFor: (details: DetailsMode, resume?: SyllabusPosition | null) => string,
  params: Omit<SyllabusCall, 'prompt' | 'schemaName' | 'temperature'>,
  onFallback: (mode: 'summary' | 'none') => void,
  onResume?: (pos: SyllabusPosition) => void,
): Promise<SyllabusResult> {
  let parts: SyllabusStructureResponse[] = [];
  let mode: DetailsMode = 'exact';
  let res: GenerateJSONResult<SyllabusStructureResponse>;
  for (;;) {
    const run = await runResumable<SyllabusStructureResponse>({
      call: (soFar) =>
        generateJSON<SyllabusStructureResponse>({
          ...params,
          prompt: promptFor(mode, soFar ? lastSyllabusPosition(soFar.subjects) : null),
          schemaName: 'syllabusStructure',
          temperature: 0.5, // 0 let Gemma loop on endless "final checks"; 1 was needlessly random for copying text
        }),
      merge: mergeParts,
      size: (d) => countTopics(d.subjects),
      initial: parts,
      onResume: (soFar) => {
        const pos = lastSyllabusPosition(soFar.subjects);
        if (pos) onResume?.(pos);
      },
    });
    res = run.res;
    parts = run.parts;
    if (res.ok || !res.recitation || mode === 'none') break;
    mode = mode === 'exact' ? 'summary' : 'none';
    onFallback(mode);
  }
  if (!res.ok && parts.length) {
    return { ok: true, data: mergeParts(parts), rawText: '', timeMs: res.timeMs, partly: true };
  }
  return res;
}

/** Turns the model's live stream into progress updates, like the paper and labelling imports do. */
function streamHandlers(
  onProgress: ImportSyllabusOptions['onProgress'],
  current: number,
  total: number,
  getAfter?: () => string | undefined,
) {
  const message = total > 1 ? `Reading batch ${current} of ${total}...` : 'Analyzing syllabus...';
  return {
    onStream: streamProgress(
      (live) => onProgress?.({ stage: 'analyzing', current, total, message, live, after: getAfter?.() }),
      countFound,
    ),
    onRetry: () =>
      onProgress?.({ stage: 'retrying', current, total, message: 'Answer was messy, asking again...' }),
  };
}

/**
 * Main importSyllabus function.
 */
export async function importSyllabus(
  options: ImportSyllabusOptions,
): Promise<SyllabusImportResult> {
  const { source, provider, apiKey, modelId, pdfWorker, onProgress, signal } = options;
  const stopped = { ok: false as const, error: 'Cancelled', friendlyError: 'Stopped.' };

  if (!apiKey || !apiKey.trim()) {
    return {
      ok: false,
      error: 'Missing API key',
      friendlyError: "Your API key doesn't work. Check it in Settings.",
    };
  }


  // --- Case 1: Pasted Text ---
  if (source.type === 'text') {
    if (!source.text.trim()) {
      return {
        ok: false,
        error: 'Empty text',
        friendlyError: 'Please enter or paste some syllabus text.',
      };
    }

    onProgress?.({
      stage: 'analyzing',
      current: 1,
      total: 1,
      message: 'Analyzing syllabus text...',
    });

    const textNotices: string[] = [];
    const res = await callSyllabus(
      (mode, resume) =>
        `${syllabusToStructurePrompt(null, mode, resume)}\n\nHere is the syllabus text:\n\"\"\"\n${source.text.trim()}\n\"\"\"`,
      { provider, apiKey, modelId, signal, ...streamHandlers(onProgress, 1, 1) },
      (mode) => textNotices.push(FALLBACK_NOTICE[mode]),
    );

    if (signal?.aborted) return stopped;
    if (!res.ok) {
      return {
        ok: false,
        error: res.error,
        friendlyError: res.friendlyError,
      };
    }

    return { ok: true, subjects: res.data.subjects, notice: textNotices.join('\n') || undefined };
  }

  // --- Case 2 & 3: PDF or Photos ---
  let pages: string[] = []; // base64 JPEG per page
  let pageNums: number[] = []; // the page number each image came from, for messages
  const notices: string[] = [];

  if (source.type === 'pdf') {
    if (!pdfWorker) {
      return {
        ok: false,
        error: 'PDF worker not initialized',
        friendlyError: 'Internal error: PDF reader not ready.',
      };
    }

    onProgress?.({
      stage: 'reading',
      current: 0,
      total: 1,
      message: 'Reading PDF pages...',
    });

    const pdfResult = await processPdf({
      fileUri: source.fileUri,
      worker: pdfWorker,
      longEdge: SYLLABUS_PDF_LONG_EDGE,
      onProgress: (p: ProcessPdfProgress) => {
        onProgress?.({
          stage: 'reading',
          current: p.current,
          total: p.total,
          message:
            p.stage === 'reading'
              ? 'Reading PDF file...'
              : p.stage === 'loading'
              ? 'Loading PDF engine...'
              : `Extracting page ${p.current} of ${p.total}...`,
        });
      },
    });

    // Only the rendered page IMAGE goes to the model (same as photos), never the PDF's extracted text.
    const readable = pdfResult.pages.filter((p) => p.result.base64);
    pages = readable.map((p) => p.result.base64!);
    pageNums = readable.map((p) => p.pageNumber);

    if (pdfResult.pageCount > pdfResult.processedCount) {
      notices.push(`Only the first ${pdfResult.processedCount} of ${pdfResult.pageCount} pages were read.`);
    }
    const unreadable = pdfResult.pages.filter((p) => !p.result.base64).map((p) => p.pageNumber);
    if (unreadable.length) notices.push(`Couldn't render page ${unreadable.join(', ')} of the PDF.`);
  } else if (source.type === 'photos') {
    pages = source.imageBase64s;
    pageNums = pages.map((_, i) => i + 1);
  }

  if (signal?.aborted) return stopped;
  if (pages.length === 0) {
    return {
      ok: false,
      error: 'No pages found',
      friendlyError: 'No readable pages found in the selected document.',
    };
  }

  // Up to CHUNK_PAGES pages go to the model together, so a subject that runs across a page break is
  // seen in one piece. A short syllabus is a single chunk. For longer ones the last subject/unit of
  // the previous chunk is passed on, because the next chunk may start in the middle of it.
  const batches: RawSyllabusSubject[][] = [];
  let size = CHUNK_PAGES; // halved whenever the model runs out of output tokens, kept smaller after that
  let position: SyllabusPosition | null = null;
  let lastError: { error: string; friendlyError: string } | undefined;
  let part = 0;

  for (let start = 0; start < pages.length; ) {
    const chunk = pages.slice(start, start + size);
    const nums = pageNums.slice(start, start + size);
    const range = nums.length > 1 ? `pages ${nums[0]}–${nums[nums.length - 1]}` : `page ${nums[0]}`;
    const totalChunks = part + Math.ceil((pages.length - start) / size);
    part++;

    let after: string | undefined; // set once an answer was stopped and the rest is being asked for
    const handlers = streamHandlers(onProgress, part, totalChunks, () => after);
    onProgress?.({
      stage: 'analyzing',
      current: part,
      total: totalChunks,
      message: totalChunks > 1 ? `Reading batch ${part} of ${totalChunks} (${range})...` : `Analyzing syllabus (${range})...`,
    });

    const pageList = chunk.map((_, idx) => `--- Page ${nums[idx]} is attached as an image ---`).join('\n');
    devLog(
      `[syllabus] part ${part}/${totalChunks}: ${range}, images ≈ ${Math.round(
        chunk.reduce((n, img) => n + img.length, 0) / 1024,
      )} KB`,
    );
    const res = await callSyllabus(
      (mode, resume) => `${syllabusToStructurePrompt(position, mode, resume)}\n\n${pageList}`,
      { images: chunk, provider, apiKey, modelId, signal, ...handlers },
      (mode) => {
        if (!notices.includes(FALLBACK_NOTICE[mode])) notices.push(FALLBACK_NOTICE[mode]);
      },
      (pos) => {
        after = pos.topic ?? pos.unit ?? pos.subject;
        devLog(`[syllabus] answer stopped early; continuing after "${after}"`);
        onProgress?.({ stage: 'analyzing', current: part, total: totalChunks, message: `Continuing after "${after}"...`, after });
      },
    );

    if (signal?.aborted) return stopped;
    if (res.ok) {
      if (res.partly) notices.push(`Only part of ${range} could be read; check the end of that part.`);
      batches.push(res.data.subjects);
      position = lastSyllabusPosition(res.data.subjects) ?? position;
      start += chunk.length;
      continue;
    }

    // Answer hit the output-token cap: the same pages in smaller pieces, no notice needed
    if (res.cutOff && chunk.length > 1) {
      size = Math.ceil(chunk.length / 2);
      part--;
      continue;
    }

    // Never drop pages silently: say which ones could not be read and why
    lastError = { error: res.error, friendlyError: res.friendlyError };
    notices.push(`Couldn't read ${range} (${res.friendlyError}) Subjects from there may be missing.`);
    if (res.fatal) {
      // Bad key, rate limit or offline: the remaining chunks would fail the same way
      const left = Math.ceil((pages.length - start - chunk.length) / size);
      if (left > 0) notices.push(`Stopped before ${left} more batch(es).`);
      break;
    }
    start += chunk.length;
  }

  if (batches.length === 0) {
    return {
      ok: false,
      error: lastError?.error ?? 'No syllabus content extracted from pages',
      friendlyError:
        lastError?.friendlyError ??
        "Couldn't extract syllabus structure from the document. Please check the pages or try another file.",
    };
  }

  if (batches.length > 1) {
    onProgress?.({
      stage: 'merging',
      current: part,
      total: part,
      message: 'Merging subjects and units...',
    });
  }

  return {
    ok: true,
    subjects: mergeSyllabusSubjects(batches),
    notice: notices.length ? notices.join('\n') : undefined,
  };
}
