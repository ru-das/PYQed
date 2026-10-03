/**
 * Pure practice-mode logic (AGENTS.md §9). No AI, no UI.
 */
import { PracticeState, Question, Subject } from './subject';
import {
  QuestionFilters,
  collapseRepeats,
  filterQuestions,
  highPriorityUnitIds,
} from './ranking';

export type PracticeSetup = {
  topicIds: Set<string>;
  highPriorityOnly: boolean;
  filters: QuestionFilters;
};

/** Questions to drill: selected topics (+ filters), one card per repeat group. */
export function practicePool(subject: Subject, setup: PracticeSetup): Question[] {
  const hp = setup.highPriorityOnly
    ? highPriorityUnitIds(subject.units, subject.questions, subject.papers.length)
    : null;
  const inScope = subject.questions.filter(
    (q) => q.topicId !== null && setup.topicIds.has(q.topicId) && (!hp || (q.unitId !== null && hp.has(q.unitId))),
  );
  return collapseRepeats(filterQuestions(inScope, setup.filters)).map((g) => g[0]);
}

const WEIGHT = { revise: 3, new: 2, got: 1 } as const;

/** Weighted random order: revise ×3, new ×2, got ×1 (Efraimidis–Spirakis keys). */
export function weightedShuffle(
  questions: Question[],
  practice: Record<string, PracticeState>,
  rand: () => number = Math.random,
): Question[] {
  return questions
    .map((q) => ({ q, key: rand() ** (1 / WEIGHT[practice[q.id]?.state ?? 'new']) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.q);
}

export function recordAnswer(
  practice: Record<string, PracticeState>,
  qid: string,
  answer: 'got' | 'revise',
  now = new Date(),
): Record<string, PracticeState> {
  return {
    ...practice,
    [qid]: { state: answer, seen: (practice[qid]?.seen ?? 0) + 1, lastSeen: now.toISOString() },
  };
}

/** Practised ÷ total for one topic (practised = seen at least once). */
export function topicProgress(
  topicId: string,
  questions: Question[],
  practice: Record<string, PracticeState>,
): { done: number; total: number } {
  const qs = questions.filter((q) => q.topicId === topicId);
  return { done: qs.filter((q) => (practice[q.id]?.seen ?? 0) > 0).length, total: qs.length };
}
