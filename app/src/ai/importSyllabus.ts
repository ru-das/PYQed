/**
 * Syllabus Import orchestrator.
 * Supports PDF (via PdfWorker), photos, or pasted text.
 * ≤ 6 pages: single AI call.
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
import type { PdfWorkerHandle } from '../pdf/PdfWorker';
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
  let pages: string[] = []; // base64 JPEG per page

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
    pages = pdfResult.pages.flatMap((p) => (p.result.base64 ? [p.result.base64] : []));
  } else if (source.type === 'photos') {
    pages = source.imageBase64s;
  }

  if (pages.length === 0) {
    return {
      ok: false,
      error: 'No pages found',
      friendlyError: 'No readable pages found in the selected document.',
    };
  }

  // --- Sub-branch A: ≤ 6 pages (Single AI call) ---
  if (pages.length <= 6) {
    onProgress?.({
      stage: 'analyzing',
      current: 1,
      total: 1,
      message: `Analyzing syllabus (${pages.length} page${pages.length > 1 ? 's' : ''})...`,
    });

    const promptText =
      `${basePrompt}\n\n` + pages.map((_, idx) => `--- Page ${idx + 1} is attached as an image ---`).join('\n');

    const res = await generateJSON<SyllabusStructureResponse>({
      prompt: promptText,
      images: pages,
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

  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + 1;
    const page = pages[i];

    onProgress?.({
      stage: 'analyzing',
      current: pageNum,
      total: pages.length,
      message: `Analyzing page ${pageNum} of ${pages.length}...`,
    });

    const res = await generateJSON<SyllabusStructureResponse>({
      prompt: `${basePrompt}\n\n--- Page ${pageNum} is attached as an image ---`,
      images: [page],
      schemaName: 'syllabusStructure',
      provider,
      apiKey,
      modelId,
    });

    // A page with no syllabus content (cover, index, instructions) is fine; skip it
    if (res.ok && res.data.subjects.length > 0) batchSubjects.push(res.data.subjects);
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
