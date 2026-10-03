// Pure subject types + helpers. No file-system imports so tests run under node.

export const CURRENT_VERSION = 1;

export type Topic = { id: string; name: string; details?: string };
export type Unit = { id: string; name: string; order: number; topics: Topic[] };
export type Paper = {
  id: string; year: number | null; session?: string; title?: string;
  sourceName: string; pageCount: number; importedAt: string;
};
export type Question = {
  id: string; paperId: string; year: number | null; page: number;
  number: string; group?: string; text: string;
  marks: number | null;
  type: 'mcq' | 'short' | 'long' | 'other';
  unitId: string | null; topicId: string | null;
  topicConfidence: 'high' | 'low' | null;
  repeatGroupId: string | null;
  isOrAlternative?: boolean;
  needsReview: boolean;
  editedByUser: boolean;
};
export type PracticeState = { state: 'new' | 'got' | 'revise'; seen: number; lastSeen?: string };

export type Subject = {
  id: string; name: string; code?: string;
  units: Unit[];
  papers: Paper[];
  questions: Question[];
  practice: Record<string, PracticeState>;
  version: number;
};

/** Entry in subjects.json: basics plus the numbers Home cards show, so Home needn't open every file. */
export type SubjectMeta = {
  id: string; name: string; code?: string;
  createdAt: string; updatedAt: string;
  unitCount: number; questionCount: number;
  yearMin: number | null; yearMax: number | null;
};

export function summarize(s: Subject) {
  const years = s.questions.map((q) => q.year).filter((y): y is number => y != null);
  return {
    unitCount: s.units.length,
    questionCount: s.questions.length,
    yearMin: years.length ? Math.min(...years) : null,
    yearMax: years.length ? Math.max(...years) : null,
  };
}

/** "5 units · 86 questions · 2019–2024" */
export function summaryLine(m: Pick<SubjectMeta, 'unitCount' | 'questionCount' | 'yearMin' | 'yearMax'>) {
  const parts = [
    `${m.unitCount} unit${m.unitCount === 1 ? '' : 's'}`,
    `${m.questionCount} question${m.questionCount === 1 ? '' : 's'}`,
  ];
  if (m.yearMin != null) parts.push(m.yearMin === m.yearMax ? `${m.yearMin}` : `${m.yearMin}–${m.yearMax}`);
  return parts.join(' · ');
}

/** Upgrade stored/imported data to the current version. Add a `case` per future version bump. */
export function migrate(raw: any): Subject {
  if (!raw || typeof raw !== 'object') throw new Error('Not a PYQed subject file.');
  const v = raw.version ?? 1;
  if (typeof v !== 'number' || v > CURRENT_VERSION) {
    throw new Error('This subject was made by a newer version of PYQed.');
  }
  // (no migrations yet)
  return {
    ...raw,
    units: raw.units ?? [],
    papers: raw.papers ?? [],
    questions: raw.questions ?? [],
    practice: raw.practice ?? {},
    version: CURRENT_VERSION,
  } as Subject;
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Question number for display: "Q3" and "3" both show as "Q3". */
export function displayNumber(n: string): string {
  return `Q${n.replace(/^q\.?\s*/i, '')}`;
}
