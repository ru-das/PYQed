/**
 * Paper import orchestrator.
 * Reads each page (text or scanned image) and asks the AI for its questions, one page at a time.
 * Tracks continuity (previous page's last question), merges questions that continue across pages,
 * detects the year, and supports resuming after a rate limit or network error.
 */

import { Provider, MAX_PAGES_PER_IMPORT } from '../config';
import { generateJSON, GenerateJSONResult, StreamEvent, streamProgress, StreamProgress } from './client';
import { pageToQuestionsPrompt } from './prompts';
import {
  ExtractedPaperMetadata,
  PageQuestionsResponse,
  RawExtractedQuestion,
} from './validators';
import type { PdfWorkerHandle } from '../pdf/PdfWorker';
import { openPdf } from '../pdf/processPdf';
import { extractYearFromFilename, mergeContinuesPrevious } from '../logic/paper';

export type PaperSource =
  | { type: 'pdf'; fileUri: string; fileName: string }
  | { type: 'photos'; imageBase64s: string[]; sourceNames?: string[] };

export type PageExtraction = {
  pageNumber: number;
  imageBase64: string;
  questions: RawExtractedQuestion[];
  paperMeta: ExtractedPaperMetadata | null;
  error?: string;
};

export type PaperImportProgress = {
  stage: 'reading' | 'extracting' | 'done';
  current: number;
  total: number;
  message: string;
  /** Live signal from the model while it reads the page (see StreamProgress) */
  live?: StreamProgress;
};

/** Counts questions in the partial JSON answer */
const QUESTION_COUNT_RE = /"number"\s*:/g;

/** Handler for extractPage that reports the model's live stream as PaperImportProgress */
export function pageStreamHandler(
  onProgress: ((p: PaperImportProgress) => void) | undefined,
  current: number,
  total: number,
) {
  return streamProgress(
    (live) => onProgress?.({ stage: 'extracting', current, total, message: `Reading page ${current} of ${total}...`, live }),
    QUESTION_COUNT_RE,
  );
}

export type PaperImportResult =
  | {
      ok: true;
      pages: PageExtraction[];
      detectedYear: number | null;
      detectedSession: string | null;
      /** Shown to the user after import, e.g. when a long PDF was cut short. */
      notice?: string;
    }
  | {
      ok: false;
      error: string;
      friendlyError: string;
      partialPages: PageExtraction[];
      lastCompletedPage: number; // how many pages are done
      detectedYear: number | null;
      detectedSession: string | null;
    };

export type ImportPaperOptions = {
  source: PaperSource;
  provider: Provider;
  apiKey: string;
  modelId: string;
  pdfWorker?: PdfWorkerHandle;
  onProgress?: (progress: PaperImportProgress) => void;
  /** Resume from this page index (0-based) */
  resumeFromPage?: number;
  /** Previously extracted pages if resuming */
  previousPages?: PageExtraction[];
  /** Checked between pages; return true to stop (user left the screen). */
  shouldCancel?: () => boolean;
};

type AiSettings = { provider: Provider; apiKey: string; modelId: string };

/** Ask the AI for the questions on one page. Used by the import loop and by "Retry this page". */
export function extractPage(
  page: { pageNumber: number; text?: string; imageBase64: string },
  totalPages: number,
  previousLastQuestion: string | undefined,
  ai: AiSettings,
  onStream?: (e: StreamEvent) => void,
): Promise<GenerateJSONResult<PageQuestionsResponse>> {
  const basePrompt = pageToQuestionsPrompt(page.pageNumber, totalPages, previousLastQuestion);
  const prompt = page.text
    ? `${basePrompt}\n\nHere is the text extracted from this page:\n"""\n${page.text}\n"""`
    : basePrompt;
  return generateJSON<PageQuestionsResponse>({
    prompt,
    images: page.imageBase64 ? [page.imageBase64] : undefined,
    schemaName: 'pageQuestions',
    onStream,
    ...ai,
  });
}

export async function importPaper(
  options: ImportPaperOptions,
): Promise<PaperImportResult> {
  const {
    source,
    provider,
    apiKey,
    modelId,
    pdfWorker,
    onProgress,
    resumeFromPage = 0,
    previousPages = [],
    shouldCancel,
  } = options;

  const fail = (
    error: string,
    friendlyError: string,
    partialPages: PageExtraction[] = previousPages,
    year: number | null = null,
    session: string | null = null,
  ): PaperImportResult => ({
    ok: false,
    error,
    friendlyError,
    partialPages,
    lastCompletedPage: partialPages.length,
    detectedYear: year,
    detectedSession: session,
  });

  if (!apiKey || !apiKey.trim()) {
    return fail('Missing API key', "Your API key doesn't work. Check it in Settings.");
  }

  // --- Step 1: Work out how many pages there are and how to get each one ---
  let totalPages = 0;
  let notice: string | undefined;
  // PDF pages are rendered one at a time as the loop reaches them, so resuming never re-renders finished pages
  let prepare: (i: number) => Promise<{ text?: string; imageBase64: string }>;

  if (source.type === 'pdf') {
    if (!pdfWorker) return fail('PDF worker not initialized', 'Internal error: PDF reader not ready.');

    onProgress?.({ stage: 'reading', current: 0, total: 1, message: 'Reading PDF document...' });
    try {
      const { pageCount } = await openPdf(source.fileUri, pdfWorker, (p) =>
        onProgress?.({
          stage: 'reading',
          current: p.current,
          total: p.total,
          message: p.stage === 'reading' ? 'Reading PDF file...' : 'Loading PDF engine...',
        }),
      );
      totalPages = Math.min(pageCount, MAX_PAGES_PER_IMPORT);
      if (pageCount > totalPages) {
        notice = `Only the first ${totalPages} of ${pageCount} pages were read.`;
      }
    } catch (err: any) {
      return fail(err?.message || 'Failed to read PDF', "Couldn't read this PDF file. Please check if the file is valid.");
    }
    prepare = async (i) => {
      const res = await pdfWorker.getPage(i + 1);
      return { text: res.type === 'text' ? res.text : undefined, imageBase64: res.base64 || '' };
    };
  } else {
    totalPages = source.imageBase64s.length;
    prepare = async (i) => ({ imageBase64: source.imageBase64s[i] });
  }

  if (totalPages === 0) {
    return fail('No pages found', 'No readable pages found in the selected document.', previousPages);
  }

  // --- Step 2: One AI call per page, in order ---
  const extractedPages: PageExtraction[] = [...previousPages];
  let detectedYear: number | null = null;
  let detectedSession: string | null = null;

  // Restore detected metadata when resuming
  for (const p of previousPages) {
    if (detectedYear === null && p.paperMeta?.year) detectedYear = p.paperMeta.year;
    if (detectedSession === null && p.paperMeta?.session) detectedSession = p.paperMeta.session;
  }

  for (let i = Math.max(0, resumeFromPage); i < totalPages; i++) {
    const pageNum = i + 1;
    if (shouldCancel?.()) {
      return fail('Cancelled', 'Import cancelled.', extractedPages, detectedYear, detectedSession);
    }

    onProgress?.({
      stage: 'extracting',
      current: pageNum,
      total: totalPages,
      message: `Reading page ${pageNum} of ${totalPages}...`,
    });

    let page: { text?: string; imageBase64: string };
    try {
      page = await prepare(i);
    } catch (err: any) {
      // One page that won't render shouldn't stop the rest; the user can add its questions by hand
      extractedPages.push({
        pageNumber: pageNum,
        imageBase64: '',
        questions: [],
        paperMeta: null,
        error: err?.message || `Page ${pageNum} could not be rendered.`,
      });
      continue;
    }

    // Last question of the previous page, so the model can tell a continuation from a new question
    const prevQs = extractedPages[extractedPages.length - 1]?.questions ?? [];
    const previousLastQuestion = prevQs.length ? prevQs[prevQs.length - 1].number : undefined;

    const res = await extractPage(
      { pageNumber: pageNum, ...page },
      totalPages,
      previousLastQuestion,
      { provider, apiKey, modelId },
      pageStreamHandler(onProgress, pageNum, totalPages),
    );

    if (!res.ok) {
      // Rate limit, bad key, offline: stop so the user can resume from this page
      if (res.fatal) {
        return fail(res.error, res.friendlyError, extractedPages, detectedYear, detectedSession);
      }
      // Otherwise just this page failed: record it, the user can retry or enter questions by hand
      extractedPages.push({
        pageNumber: pageNum,
        imageBase64: page.imageBase64,
        questions: [],
        paperMeta: null,
        error: res.error,
      });
      continue;
    }

    let currentQuestions = [...res.data.questions];

    if (extractedPages.length > 0 && currentQuestions.length > 0 && currentQuestions[0].continues_previous) {
      const prevIndex = extractedPages.length - 1;
      const merged = mergeContinuesPrevious(extractedPages[prevIndex].questions, currentQuestions);
      extractedPages[prevIndex].questions = merged.prev;
      currentQuestions = merged.current;
    }

    if (detectedYear === null && res.data.paper?.year) detectedYear = res.data.paper.year;
    if (detectedSession === null && res.data.paper?.session) detectedSession = res.data.paper.session;

    extractedPages.push({
      pageNumber: pageNum,
      imageBase64: page.imageBase64,
      questions: currentQuestions,
      paperMeta: res.data.paper,
    });
  }

  // --- Step 3: No year on any page? Try the file name ---
  if (detectedYear === null) {
    const names = source.type === 'pdf' ? [source.fileName] : source.sourceNames ?? [];
    for (const name of names) {
      detectedYear = extractYearFromFilename(name);
      if (detectedYear !== null) break;
    }
  }

  return { ok: true, pages: extractedPages, detectedYear, detectedSession, notice };
}
