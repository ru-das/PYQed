/**
 * Background syllabus import. Lives at module level so the import keeps running (and its result is
 * kept) when the user leaves the import screen. The screen and the Home banner just subscribe.
 */
import { getApiSettings } from './settings';
import { toast } from '../components/Toast';
import {
  importSyllabus,
  SyllabusSource,
  SyllabusImportProgress,
} from './importSyllabus';
import type { RawSyllabusSubject } from './validators';
import type { PdfWorkerHandle } from '../pdf/PdfWorker';
import { showProgress, finish } from '../notify';

export type SyllabusJob = {
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt: number;
  endedAt: number;
  progress: SyllabusImportProgress;
  source?: SyllabusSource;
  result?: RawSyllabusSubject[];
  /** Pages or parts that could not be read; shown when the review screen opens. */
  notice?: string;
  error?: string;
  errorDetail?: string;
};

const START: SyllabusImportProgress = {
  stage: 'reading',
  current: 0,
  total: 1,
  message: 'Getting your syllabus ready...',
};
const IDLE: SyllabusJob = { status: 'idle', startedAt: 0, endedAt: 0, progress: START };

// Kept on globalThis so a dev hot reload (which re-runs this file) doesn't orphan a running import
const store: { job: SyllabusJob; listeners: Set<() => void> } = ((globalThis as any).__pyqedSyllabusJob ??= {
  job: IDLE,
  listeners: new Set(),
});

function set(patch: Partial<SyllabusJob>) {
  store.job = { ...store.job, ...patch };
  store.listeners.forEach((fn) => fn());
}

export const getSyllabusJob = () => store.job;

export function subscribe(fn: () => void) {
  store.listeners.add(fn);
  return () => {
    store.listeners.delete(fn);
  };
}

let controller: AbortController | undefined;

/** Stops the running import (and its AI call) and returns to idle. */
export function cancelSyllabusJob() {
  controller?.abort();
  clearSyllabusJob();
  finish('Import stopped', 'You can start again any time.'); // also removes the sticky progress notification
}

export function clearSyllabusJob() {
  store.job = IDLE;
  store.listeners.forEach((fn) => fn());
}

/**
 * Starts (or restarts) the import. `getWorker` is only called for PDFs: the PDF reader is a
 * WebView owned by the screen, needed just while pages are rendered.
 */
// ponytail: leaving the screen while a PDF is still being rendered unmounts the reader and the
// import fails; Retry works. Move the reader into the root layout if that turns out to be common.
export async function startSyllabusJob(
  source: SyllabusSource,
  getWorker?: () => Promise<PdfWorkerHandle | undefined>,
) {
  controller?.abort(); // a restart replaces any run still going
  const signal = (controller = new AbortController()).signal;
  set({
    status: 'running',
    startedAt: Date.now(),
    progress: START,
    source,
    result: undefined,
    notice: undefined,
    error: undefined,
    errorDetail: undefined,
  });

  try {
    const api = await getApiSettings();
    const result = await importSyllabus({
      source,
      provider: api.provider,
      apiKey: api.apiKey,
      modelId: api.modelId,
      pdfWorker: source.type === 'pdf' ? await getWorker?.() : undefined,
      signal,
      onProgress: (p) => {
        if (signal.aborted) return; // a late update must not bring the notification back after Stop
        set({ progress: p });
        showProgress('Reading syllabus', p.message);
      },
    });

    if (signal.aborted) return; // stopped: the job was already cleared
    if (!result.ok) {
      const msg = result.friendlyError || result.error;
      finish("Couldn't finish reading", msg + ' Open PYQed to retry.');
      set({ status: 'error', endedAt: Date.now(), error: msg, errorDetail: result.error });
      return;
    }
    finish('Syllabus ready to review', 'Open PYQed to check the subjects.');
    const n = result.subjects.length;
    toast(`Syllabus read: ${n} subject${n === 1 ? '' : 's'} found. Review before saving.`);
    set({ status: 'done', endedAt: Date.now(), result: result.subjects, notice: result.notice });
  } catch (err: any) {
    if (signal.aborted) return;
    const msg = err?.message || 'Failed to import syllabus.';
    finish("Couldn't finish reading", msg);
    set({ status: 'error', endedAt: Date.now(), error: msg });
  }
}
