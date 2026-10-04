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

let job: SyllabusJob = IDLE;
const listeners = new Set<() => void>();

function set(patch: Partial<SyllabusJob>) {
  job = { ...job, ...patch };
  listeners.forEach((fn) => fn());
}

export const getSyllabusJob = () => job;

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function clearSyllabusJob() {
  job = IDLE;
  listeners.forEach((fn) => fn());
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
  set({
    status: 'running',
    startedAt: Date.now(),
    progress: START,
    source,
    result: undefined,
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
      onProgress: (p) => {
        set({ progress: p });
        showProgress('Reading syllabus', p.message);
      },
    });

    if (!result.ok) {
      const msg = result.friendlyError || result.error;
      finish("Couldn't finish reading", msg + ' Open PYQed to retry.');
      set({ status: 'error', endedAt: Date.now(), error: msg, errorDetail: result.error });
      return;
    }
    finish('Syllabus ready to review', 'Open PYQed to check the subjects.');
    const n = result.subjects.length;
    toast(`Syllabus read: ${n} subject${n === 1 ? '' : 's'} found. Review before saving.`);
    set({ status: 'done', endedAt: Date.now(), result: result.subjects });
  } catch (err: any) {
    const msg = err?.message || 'Failed to import syllabus.';
    finish("Couldn't finish reading", msg);
    set({ status: 'error', endedAt: Date.now(), error: msg });
  }
}
