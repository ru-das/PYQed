import { readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { MAX_PAGES_PER_IMPORT } from '../config';
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

/**
 * Orchestrates PDF processing:
 * 1. Reads local PDF file as base64 using expo-file-system/legacy
 * 2. Loads into the hidden pdf.js WebView worker
 * 3. Extracts pages sequentially (one page at a time)
 * 4. Categorizes each page as either 'text' (>200 non-space chars) or 'image' (~1600px JPEG)
 */
export async function processPdf(options: ProcessPdfOptions): Promise<ProcessPdfResult> {
  const {
    fileUri,
    worker,
    maxPages = MAX_PAGES_PER_IMPORT,
    onProgress,
  } = options;

  const startTime = Date.now();

  // Stage 1: Read file
  onProgress?.({ stage: 'reading', current: 0, total: 1 });
  const base64 = await readAsStringAsync(fileUri, {
    encoding: EncodingType.Base64,
  });

  // Stage 2: Load into pdf.js worker
  onProgress?.({ stage: 'loading', current: 0, total: 1 });
  const { pageCount } = await worker.loadPdf(base64);

  const totalToProcess = Math.min(pageCount, maxPages);
  const pages: ProcessedPdfPage[] = [];

  // Stage 3: Process pages sequentially
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
