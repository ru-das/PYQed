/**
 * Paper Import orchestrator (AGENTS.md §8.2, §4).
 * Reads each page (text or scanned image), invokes Gemma 4 sequentially per page.
 * Tracks continuity (previousLastQuestion), merges continues_previous,
 * extracts year and metadata, supports resuming on rate limit / network error.
 */

import { Provider } from '../config';
import { generateJSON } from './client';
import { pageToQuestionsPrompt } from './prompts';
import {
  ExtractedPaperMetadata,
  PageQuestionsResponse,
  RawExtractedQuestion,
} from './validators';
import type { PdfWorkerHandle, PageResult } from '../pdf/PdfWorker';
import { processPdf, ProcessPdfProgress } from '../pdf/processPdf';
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
  friendlyError?: string;
};

export type PaperImportProgress = {
  stage: 'reading' | 'extracting' | 'done';
  current: number;
  total: number;
  message: string;
};

export type PaperImportResult =
  | {
      ok: true;
      pages: PageExtraction[];
      detectedYear: number | null;
      detectedSession: string | null;
      detectedSubjectName: string | null;
      detectedSubjectCode: string | null;
    }
  | {
      ok: false;
      error: string;
      friendlyError: string;
      partialPages: PageExtraction[];
      lastCompletedPage: number; // 0-indexed count of completed pages
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
};

type PreparedPage = {
  pageNumber: number;
  type: 'text' | 'image';
  text?: string;
  imageBase64: string;
};

/**
 * Checks if an error is a fatal / transport error that should halt the queue
 * so the user can resume (429 rate limit, 401/403 auth, network disconnect).
 */
function isFatalError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('daily limit') ||
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    lower.includes('timed out') ||
    lower.includes('timeout')
  );
}

/**
 * Main importPaper orchestrator.
 */
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
  } = options;

  if (!apiKey || !apiKey.trim()) {
    return {
      ok: false,
      error: 'Missing API key',
      friendlyError: "Your API key doesn't work. Check it in Settings.",
      partialPages: previousPages,
      lastCompletedPage: previousPages.length,
      detectedYear: null,
      detectedSession: null,
    };
  }

  // --- Step 1: Prepare pages (read PDF or format photos) ---
  let preparedPages: PreparedPage[] = [];

  if (source.type === 'pdf') {
    if (!pdfWorker) {
      return {
        ok: false,
        error: 'PDF worker not initialized',
        friendlyError: 'Internal error: PDF reader not ready.',
        partialPages: previousPages,
        lastCompletedPage: previousPages.length,
        detectedYear: null,
        detectedSession: null,
      };
    }

    onProgress?.({
      stage: 'reading',
      current: 0,
      total: 1,
      message: 'Reading PDF document...',
    });

    try {
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

      preparedPages = pdfResult.pages.map((p) => {
        const res = p.result;
        if (res.type === 'text') {
          return {
            pageNumber: p.pageNumber,
            type: 'text',
            text: res.text,
            imageBase64: res.base64 || '',
          };
        }
        return {
          pageNumber: p.pageNumber,
          type: 'image',
          imageBase64: res.base64 || '',
        };
      });
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || 'Failed to read PDF',
        friendlyError: "Couldn't read this PDF file. Please check if the file is valid.",
        partialPages: previousPages,
        lastCompletedPage: previousPages.length,
        detectedYear: null,
        detectedSession: null,
      };
    }
  } else if (source.type === 'photos') {
    preparedPages = source.imageBase64s.map((base64, idx) => ({
      pageNumber: idx + 1,
      type: 'image',
      imageBase64: base64,
    }));
  }

  const totalPages = preparedPages.length;
  if (totalPages === 0) {
    return {
      ok: false,
      error: 'No pages found',
      friendlyError: 'No readable pages found in the selected document.',
      partialPages: previousPages,
      lastCompletedPage: 0,
      detectedYear: null,
      detectedSession: null,
    };
  }

  // --- Step 2: Sequential Gemma 4 extraction per page ---
  const extractedPages: PageExtraction[] = [...previousPages];
  let detectedYear: number | null = null;
  let detectedSession: string | null = null;
  let detectedSubjectName: string | null = null;
  let detectedSubjectCode: string | null = null;

  // Restore existing detected metadata from previousPages if resuming
  for (const p of previousPages) {
    if (detectedYear === null && p.paperMeta?.year) {
      detectedYear = p.paperMeta.year;
    }
    if (detectedSession === null && p.paperMeta?.session) {
      detectedSession = p.paperMeta.session;
    }
    if (detectedSubjectName === null && p.paperMeta?.subject_name) {
      detectedSubjectName = p.paperMeta.subject_name;
    }
    if (detectedSubjectCode === null && p.paperMeta?.subject_code) {
      detectedSubjectCode = p.paperMeta.subject_code;
    }
  }

  const startIdx = Math.max(0, resumeFromPage);

  for (let i = startIdx; i < totalPages; i++) {
    const page = preparedPages[i];
    const pageNum = page.pageNumber;

    onProgress?.({
      stage: 'extracting',
      current: pageNum,
      total: totalPages,
      message: `Reading page ${pageNum} of ${totalPages}...`,
    });

    // Determine the last question number from the previous completed page for continuity
    let previousLastQuestion: string | undefined = undefined;
    if (extractedPages.length > 0) {
      const lastPageQuestions = extractedPages[extractedPages.length - 1].questions;
      if (lastPageQuestions.length > 0) {
        previousLastQuestion = lastPageQuestions[lastPageQuestions.length - 1].number;
      }
    }

    const basePrompt = pageToQuestionsPrompt(pageNum, totalPages, previousLastQuestion);
    let promptText = basePrompt;
    let images: string[] | undefined = undefined;

    if (page.type === 'text' && page.text) {
      promptText = `${basePrompt}\n\nHere is the text extracted from this page:\n"""\n${page.text}\n"""`;
      // For text pages, if we also have an image, pass it as image fallback
      if (page.imageBase64) {
        images = [page.imageBase64];
      }
    } else if (page.imageBase64) {
      images = [page.imageBase64];
    }

    const res = await generateJSON<PageQuestionsResponse>({
      prompt: promptText,
      images,
      schemaName: 'pageQuestions',
      provider,
      apiKey,
      modelId,
    });

    if (!res.ok) {
      // Check if fatal error (rate limit 429, auth, network)
      if (isFatalError(res.error) || isFatalError(res.friendlyError)) {
        return {
          ok: false,
          error: res.error,
          friendlyError: res.friendlyError,
          partialPages: extractedPages,
          lastCompletedPage: extractedPages.length,
          detectedYear,
          detectedSession,
        };
      }

      // Per-page non-fatal error: record page failure, let user retry or enter manually in review (AGENTS.md §6)
      extractedPages.push({
        pageNumber: pageNum,
        imageBase64: page.imageBase64,
        questions: [],
        paperMeta: null,
        error: res.error,
        friendlyError: res.friendlyError,
      });
      continue;
    }

    // Process questions and continuity
    let currentQuestions = [...res.data.questions];

    if (
      extractedPages.length > 0 &&
      currentQuestions.length > 0 &&
      currentQuestions[0].continues_previous
    ) {
      const prevPageIndex = extractedPages.length - 1;
      const prevQuestions = extractedPages[prevPageIndex].questions;
      const merged = mergeContinuesPrevious(prevQuestions, currentQuestions);
      extractedPages[prevPageIndex].questions = merged.prev;
      currentQuestions = merged.current;
    }

    // Update paper metadata if found
    if (detectedYear === null && res.data.paper?.year) {
      detectedYear = res.data.paper.year;
    }
    if (detectedSession === null && res.data.paper?.session) {
      detectedSession = res.data.paper.session;
    }
    if (detectedSubjectName === null && res.data.paper?.subject_name) {
      detectedSubjectName = res.data.paper.subject_name;
    }
    if (detectedSubjectCode === null && res.data.paper?.subject_code) {
      detectedSubjectCode = res.data.paper.subject_code;
    }

    extractedPages.push({
      pageNumber: pageNum,
      imageBase64: page.imageBase64,
      questions: currentQuestions,
      paperMeta: res.data.paper,
    });
  }

  // --- Step 3: Fallback Year Detection (AGENTS.md §8.2) ---
  if (detectedYear === null) {
    if (source.type === 'pdf') {
      detectedYear = extractYearFromFilename(source.fileName);
    } else if (source.type === 'photos' && source.sourceNames && source.sourceNames.length > 0) {
      for (const name of source.sourceNames) {
        const parsed = extractYearFromFilename(name);
        if (parsed !== null) {
          detectedYear = parsed;
          break;
        }
      }
    }
  }

  return {
    ok: true,
    pages: extractedPages,
    detectedYear,
    detectedSession,
    detectedSubjectName,
    detectedSubjectCode,
  };
}
