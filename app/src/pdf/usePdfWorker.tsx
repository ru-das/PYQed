import React, { useRef, useState } from 'react';
import { PdfWorker, PdfWorkerHandle } from './PdfWorker';

/**
 * The hidden PDF reader is only mounted once a PDF is picked (photos and pasted text never need it).
 * `ensureWorker()` mounts it and waits for its handle; render `worker` once in the screen.
 */
export function usePdfWorker() {
  const ref = useRef<PdfWorkerHandle>(null);
  const [on, setOn] = useState(false);
  const ensureWorker = async () => {
    setOn(true);
    for (let i = 0; i < 100 && !ref.current; i++) await new Promise((r) => setTimeout(r, 50));
    return ref.current ?? undefined;
  };
  return { ensureWorker, worker: on ? <PdfWorker ref={ref} /> : null };
}
