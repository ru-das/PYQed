// Pure export/import helpers for .pyqed.json files (AGENTS.md §10 Sharing). No file-system imports.
import { migrate, newId, Subject, CURRENT_VERSION } from './subject';

export type ShareFile = {
  app: 'pyqed';
  version: number;
  subject: Omit<Subject, 'practice' | 'id'>;
  images?: Record<string, string>; // "{paperId}_{n}.jpg" -> base64
};

const BAD = "This isn't a valid PYQed subject file.";
const isObj = (x: any) => x && typeof x === 'object' && !Array.isArray(x);

/** Subject without practice state or id; page images only if given. */
export function toShareFile(s: Subject, images?: Record<string, string>): ShareFile {
  const { practice, id, ...rest } = s;
  return { app: 'pyqed', version: CURRENT_VERSION, subject: rest, ...(images ? { images } : {}) };
}

/** Validate an untrusted file and return a fresh subject (new id, empty practice). Throws a friendly Error. */
export function parseShareFile(raw: any): { subject: Subject; images: Record<string, string> } {
  if (!isObj(raw) || raw.app !== 'pyqed' || !isObj(raw.subject)) throw new Error(BAD);
  const subject = migrate({ ...raw.subject, version: raw.version }); // throws "newer version" error
  if (typeof subject.name !== 'string' || !subject.name.trim()) throw new Error(BAD);

  const arrays = [subject.units, subject.papers, subject.questions];
  if (!arrays.every((a) => Array.isArray(a) && a.every((x) => isObj(x) && typeof x.id === 'string'))) {
    throw new Error(BAD);
  }
  if (!subject.units.every((u) => typeof u.name === 'string' && Array.isArray(u.topics) &&
      u.topics.every((t) => isObj(t) && typeof t.id === 'string' && typeof t.name === 'string'))) {
    throw new Error(BAD);
  }

  // Dangling refs -> Unassigned rather than a crash later.
  const unitIds = new Set(subject.units.map((u) => u.id));
  const topicIds = new Set(subject.units.flatMap((u) => u.topics.map((t) => t.id)));
  for (const q of subject.questions) {
    if (typeof q.text !== 'string' || !(q.marks === null || typeof q.marks === 'number')) throw new Error(BAD);
    if (q.topicId && !topicIds.has(q.topicId)) { q.topicId = null; q.topicConfidence = null; }
    if (q.unitId && !unitIds.has(q.unitId)) q.unitId = null;
  }

  const images: Record<string, string> = {};
  if (isObj(raw.images)) {
    for (const [k, v] of Object.entries(raw.images)) {
      // Only plain "{id}_{n}.jpg" names: blocks path tricks like "../x".
      if (typeof v === 'string' && /^[\w-]+_\d+\.jpg$/.test(k)) images[k] = v;
    }
  }
  return { subject: { ...subject, id: newId(), practice: {} }, images };
}

/** "{name}.pyqed.json" with filesystem-unsafe characters removed. */
export function shareFileName(name: string): string {
  const clean = name.replace(/[\/\\:*?"<>|]/g, '').trim() || 'subject';
  return `${clean}.pyqed.json`;
}
