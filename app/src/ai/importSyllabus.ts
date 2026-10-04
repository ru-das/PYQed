/**
 * Syllabus Import orchestrator.
 * Supports PDF (via PdfWorker), photos, or pasted text.
 * Pages go to the model in chunks of up to 6 (one call for a short syllabus). Each chunk after the first is
 * told which subject/unit the previous one ended in, then the chunks are merged by subject name.
 * Pages or chunks that fail are reported in `notice`, never dropped silently.
 */

import { Provider } from '../config';
import { generateJSON, streamProgress, StreamProgress } from './client';
import { syllabusToStructurePrompt } from './prompts';
import {
  RawSyllabusSubject,
  SyllabusStructureResponse,
} from './validators';
import type { PdfWorkerHandle } from '../pdf/PdfWorker';
import { processPdf, ProcessPdfProgress } from '../pdf/processPdf';
import { lastSyllabusPosition, mergeSyllabusSubjects, SyllabusPosition } from '../logic/syllabus';

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
};

/** Pages sent to the model per call. */
const CHUNK_PAGES = 6;

const count = (text: string, re: RegExp) => (text.match(re) || []).length;

/** Units and topics in the partial JSON answer. Every unit has a "topics" key and every subject a
 *  "units" key, so topics = all "name" keys minus the subject and unit names. */
function countFound(text: string) {
  const units = count(text, /"topics"\s*:/g);
  const subjects = count(text, /"units"\s*:/g);
  return { units, topics: Math.max(0, count(text, /"name"\s*:/g) - units - subjects) };
}

/** Turns the model's live stream into progress updates, like the paper and labelling imports do. */
function streamHandlers(
  onProgress: ImportSyllabusOptions['onProgress'],
  current: number,
  total: number,
) {
  const message = total > 1 ? `Analyzing page ${current} of ${total}...` : 'Analyzing syllabus...';
  return {
    onStream: streamProgress(
      (live) => onProgress?.({ stage: 'analyzing', current, total, message, live }),
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
  const { source, provider, apiKey, modelId, pdfWorker, onProgress } = options;

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

    const prompt = `${syllabusToStructurePrompt()}\n\nHere is the syllabus text:\n\"\"\"\n${source.text.trim()}\n\"\"\"`;

    const res = await generateJSON<SyllabusStructureResponse>({
      prompt,
      schemaName: 'syllabusStructure',
      provider,
      apiKey,
      modelId,
      temperature: 1, // 0 let Gemma loop on endless "final checks"
      ...streamHandlers(onProgress, 1, 1),
    });

    if (!res.ok) {
      return {
        ok: false,
        error: res.error,
        friendlyError: res.friendlyError,
      };
    }

    return { ok: true, subjects: res.data.subjects };
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

    // Always send the page image, even for text pages: table text extracts in a messy order.
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
  const totalChunks = Math.ceil(pages.length / CHUNK_PAGES);
  let position: SyllabusPosition | null = null;
  let lastError: { error: string; friendlyError: string } | undefined;

  for (let c = 0; c < totalChunks; c++) {
    const chunk = pages.slice(c * CHUNK_PAGES, (c + 1) * CHUNK_PAGES);
    const nums = pageNums.slice(c * CHUNK_PAGES, (c + 1) * CHUNK_PAGES);
    const range = nums.length > 1 ? `pages ${nums[0]}–${nums[nums.length - 1]}` : `page ${nums[0]}`;

    const handlers = streamHandlers(onProgress, c + 1, totalChunks);
    onProgress?.({
      stage: 'analyzing',
      current: c + 1,
      total: totalChunks,
      message: totalChunks > 1 ? `Analyzing ${range} (part ${c + 1} of ${totalChunks})...` : `Analyzing syllabus (${range})...`,
    });

    const prompt: string =
      `${syllabusToStructurePrompt(position)}\n\n` +
      chunk.map((_, idx) => `--- Page ${nums[idx]} is attached as an image ---`).join('\n');
    const res = await generateJSON<SyllabusStructureResponse>({
      prompt,
      images: chunk,
      schemaName: 'syllabusStructure',
      provider,
      apiKey,
      modelId,
      temperature: 1, // 0 let Gemma loop on endless "final checks"
      ...handlers,
    });

    if (res.ok) {
      batches.push(res.data.subjects);
      position = lastSyllabusPosition(res.data.subjects) ?? position;
      continue;
    }

    // Never drop pages silently: say which ones could not be read and why
    lastError = { error: res.error, friendlyError: res.friendlyError };
    notices.push(`Couldn't read ${range} (${res.friendlyError}) Subjects from there may be missing.`);
    if (res.fatal) {
      // Bad key, rate limit or offline: the remaining chunks would fail the same way
      if (c + 1 < totalChunks) notices.push(`Stopped before ${totalChunks - c - 1} more part(s).`);
      break;
    }
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
      current: totalChunks,
      total: totalChunks,
      message: 'Merging subjects and units...',
    });
  }

  return {
    ok: true,
    subjects: mergeSyllabusSubjects(batches),
    notice: notices.length ? notices.join('\n') : undefined,
  };
}
