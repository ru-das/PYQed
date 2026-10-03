/**
 * Syllabus Import orchestrator (AGENTS.md §8.1).
 * Supports PDF (via PdfWorker), photos, or pasted text.
 * ≤ 6 pages: single Gemma call.
 * > 6 pages: per-page sequential calls + merge by subject name.
 */

import { Provider } from '../config';
import { generateJSON } from './client';
import { syllabusToStructurePrompt } from './prompts';
import {
  RawSyllabusSubject,
  RawSyllabusUnit,
  RawSyllabusTopic,
  SyllabusStructureResponse,
} from './validators';
import type { PdfWorkerHandle, PageResult } from '../pdf/PdfWorker';
import { processPdf, ProcessPdfProgress } from '../pdf/processPdf';
import { mergeSyllabusSubjects } from '../logic/syllabus';

export { mergeSyllabusSubjects };

export type SyllabusSource =
  | { type: 'pdf'; fileUri: string }
  | { type: 'photos'; imageBase64s: string[] }
  | { type: 'text'; text: string };

export type SyllabusImportProgress = {
  stage: 'reading' | 'analyzing' | 'merging';
  current: number;
  total: number;
  message: string;
};

export type SyllabusImportResult =
  | { ok: true; subjects: RawSyllabusSubject[] }
  | { ok: false; error: string; friendlyError: string };

export type ImportSyllabusOptions = {
  source: SyllabusSource;
  provider: Provider;
  apiKey: string;
  modelId: string;
  pdfWorker?: PdfWorkerHandle;
  onProgress?: (progress: SyllabusImportProgress) => void;
};


type SyllabusPageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; base64: string };

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

  const basePrompt = syllabusToStructurePrompt();

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

    const prompt = `${basePrompt}\n\nHere is the syllabus text:\n\"\"\"\n${source.text.trim()}\n\"\"\"`;

    const res = await generateJSON<SyllabusStructureResponse>({
      prompt,
      schemaName: 'syllabusStructure',
      provider,
      apiKey,
      modelId,
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
  let pages: SyllabusPageContent[] = [];

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
    pages = pdfResult.pages.flatMap((p): SyllabusPageContent[] => {
      const base64 = p.result.base64;
      return base64 ? [{ type: 'image', base64 }] : [];
    });
  } else if (source.type === 'photos') {
    pages = source.imageBase64s.map((base64) => ({
      type: 'image',
      base64,
    }));
  }

  if (pages.length === 0) {
    return {
      ok: false,
      error: 'No pages found',
      friendlyError: 'No readable pages found in the selected document.',
    };
  }

  // --- Sub-branch A: ≤ 6 pages (Single Gemma call) ---
  if (pages.length <= 6) {
    onProgress?.({
      stage: 'analyzing',
      current: 1,
      total: 1,
      message: `Analyzing syllabus (${pages.length} page${pages.length > 1 ? 's' : ''})...`,
    });

    let promptText = `${basePrompt}\n\n`;
    const images: string[] = [];

    pages.forEach((p, idx) => {
      const pageNum = idx + 1;
      if (p.type === 'text') {
        promptText += `\n--- Page ${pageNum} text ---\n${p.text}\n`;
      } else {
        promptText += `\n--- Page ${pageNum} is attached as an image ---\n`;
        images.push(p.base64);
      }
    });

    const res = await generateJSON<SyllabusStructureResponse>({
      prompt: promptText,
      images: images.length > 0 ? images : undefined,
      schemaName: 'syllabusStructure',
      provider,
      apiKey,
      modelId,
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

  // --- Sub-branch B: > 6 pages (Per-page calls + merge) ---
  const batchSubjects: RawSyllabusSubject[][] = [];
  let failureCount = 0;

  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + 1;
    const page = pages[i];

    onProgress?.({
      stage: 'analyzing',
      current: pageNum,
      total: pages.length,
      message: `Analyzing page ${pageNum} of ${pages.length}...`,
    });

    let pagePrompt = `${basePrompt}\n\n`;
    const pageImages: string[] = [];

    if (page.type === 'text') {
      pagePrompt += `--- Page ${pageNum} text ---\n${page.text}`;
    } else {
      pagePrompt += `--- Page ${pageNum} is attached as an image ---`;
      pageImages.push(page.base64);
    }

    const res = await generateJSON<SyllabusStructureResponse>({
      prompt: pagePrompt,
      images: pageImages.length > 0 ? pageImages : undefined,
      schemaName: 'syllabusStructure',
      provider,
      apiKey,
      modelId,
    });

    if (res.ok && res.data.subjects.length > 0) {
      batchSubjects.push(res.data.subjects);
    } else {
      // Non-fatal if a single page doesn't have syllabus subjects (e.g. index/cover/instructions page)
      failureCount++;
    }
  }

  if (batchSubjects.length === 0) {
    return {
      ok: false,
      error: 'No syllabus content extracted from pages',
      friendlyError:
        "Couldn't extract syllabus structure from the document. Please check the pages or try another file.",
    };
  }

  onProgress?.({
    stage: 'merging',
    current: pages.length,
    total: pages.length,
    message: 'Merging subjects and units...',
  });

  const merged = mergeSyllabusSubjects(batchSubjects);

  return { ok: true, subjects: merged };
}
