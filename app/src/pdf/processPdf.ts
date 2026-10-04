import { File } from 'expo-file-system';
import { getPrefs } from '../prefs';
import { PdfWorkerHandle, PageResult } from './PdfWorker';

export type ProcessedPdfPage = {
  pageNumber: number;
  result: PageResult;
  timeMs: number;
  error?: string;
};

export type ProcessPdfProgress = {
  stage: 'reading' | 'loading' | 'page';
  current: number;
  total: number;
};

export type ProcessPdfOptions = {
  fileUri: string;
  worker: PdfWorkerHandle;
  maxPages?: number;
  onProgress?: (progress: ProcessPdfProgress) => void;
};

export type ProcessPdfResult = {
  pageCount: number;
  processedCount: number;
  pages: ProcessedPdfPage[];
  totalTimeMs: number;
};

/** Read a PDF file and load it into the worker. Pages are rendered later, one at a time, with worker.getPage. */
export async function openPdf(
  fileUri: string,
  worker: PdfWorkerHandle,
  onProgress?: (progress: ProcessPdfProgress) => void,
): Promise<{ pageCount: number }> {
  onProgress?.({ stage: 'reading', current: 0, total: 1 });
  // New File API reads content:// URIs directly (the legacy API refuses them in Expo Go).
  const base64 = await new File(fileUri).base64();

  onProgress?.({ stage: 'loading', current: 0, total: 1 });
  return worker.loadPdf(base64);
}

/**
 * Open a PDF and render every page up front (used by syllabus import, which sends all pages in one call).
 * Each page comes back as 'text' (>200 non-space chars) or 'image' (~1600px JPEG).
 */
export async function processPdf(options: ProcessPdfOptions): Promise<ProcessPdfResult> {
  const {
    fileUri,
    worker,
    maxPages = getPrefs().maxPages,
    onProgress,
  } = options;

  const startTime = Date.now();
  const { pageCount } = await openPdf(fileUri, worker, onProgress);

  const totalToProcess = Math.min(pageCount, maxPages);
  const pages: ProcessedPdfPage[] = [];

  for (let pageNum = 1; pageNum <= totalToProcess; pageNum++) {
    onProgress?.({
      stage: 'page',
      current: pageNum,
      total: totalToProcess,
    });

    const pageStart = Date.now();
    try {
      const result = await worker.getPage(pageNum);
      pages.push({
        pageNumber: pageNum,
        result,
        timeMs: Date.now() - pageStart,
      });
    } catch (err: any) {
      // Record page error without aborting remaining pages
      pages.push({
        pageNumber: pageNum,
        result: {
          type: 'image',
          base64: '',
        },
        timeMs: Date.now() - pageStart,
        error: err?.message || `Failed to process page ${pageNum}`,
      });
    }
  }

  return {
    pageCount,
    processedCount: pages.length,
    pages,
    totalTimeMs: Date.now() - startTime,
  };
}
