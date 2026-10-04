/**
 * Pure ranking, sorting, and filtering logic.
 * Every number shown in the app is computed here — never from AI.
 */
import { Question, Unit } from './subject';

// ─── Times Asked ────────────────────────────────────────────────

/** repeatGroupId -> its questions. Build once per render; passing it avoids re-filtering all questions per card. */
export type GroupIndex = Map<string, Question[]>;

export function groupIndex(allQuestions: Question[]): GroupIndex {
  const idx: GroupIndex = new Map();
  for (const q of allQuestions) {
    if (!q.repeatGroupId) continue;
    const g = idx.get(q.repeatGroupId);
    if (g) g.push(q);
    else idx.set(q.repeatGroupId, [q]);
  }
  return idx;
}

function groupOf(question: Question, allQuestions: Question[], groups?: GroupIndex): Question[] {
  if (!question.repeatGroupId) return [question];
  return (groups ?? groupIndex(allQuestions)).get(question.repeatGroupId) ?? [question];
}

/**
 * Times asked = number of distinct papers containing a question
 * or any question in its repeat group. (1 if no repeat group).
 */
export function timesAsked(
  question: Question,
  allQuestions: Question[],
  groups?: GroupIndex,
): number {
  if (!question.repeatGroupId) return 1;
  const paperIds = new Set(groupOf(question, allQuestions, groups).map((q) => q.paperId));
  return Math.max(1, paperIds.size);
}

/**
 * Distinct non-null years (ascending) in the question's repeat group.
 */
export function askedYears(
  question: Question,
  allQuestions: Question[],
  groups?: GroupIndex,
): number[] {
  const years = new Set<number>();
  for (const q of groupOf(question, allQuestions, groups)) if (q.year !== null) years.add(q.year);
  return Array.from(years).sort((a, b) => a - b);
}

/**
 * One entry per repeat group, in order of first appearance in `sorted`.
 * Each entry is [representative, ...otherVersions]; the representative is
 * the most recent wording. Ungrouped questions are single-item entries.
 */
export function collapseRepeats(sorted: Question[]): Question[][] {
  const out: Question[][] = [];
  const byGroup = new Map<string, Question[]>();
  for (const q of sorted) {
    if (!q.repeatGroupId) {
      out.push([q]);
      continue;
    }
    let g = byGroup.get(q.repeatGroupId);
    if (!g) {
      g = [];
      byGroup.set(q.repeatGroupId, g);
      out.push(g);
    }
    g.push(q);
  }
  for (const g of out) {
    g.sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity));
  }
  return out;
}

/**
 * Repeats (§8.4), found by code: questions with the same wording (ignoring case and punctuation)
 * that appear in at least 2 different years. Same wording twice in one year is not a repeat.
 * A question from an undated paper counts as its own "year", since it may be from another one.
 * Group id = the first member's id, so the result is stable. Returns all questions with repeatGroupId set.
 */
export function findRepeats(questions: Question[]): Question[] {
  const byText = new Map<string, Question[]>();
  for (const q of questions) {
    const key = q.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!key) continue;
    const g = byText.get(key);
    if (g) g.push(q);
    else byText.set(key, [q]);
  }
  const groupOfId = new Map<string, string>();
  for (const g of byText.values()) {
    if (new Set(g.map((q) => q.year ?? q.paperId)).size < 2) continue;
    for (const q of g) groupOfId.set(q.id, g[0].id);
  }
  return questions.map((q) => ({ ...q, repeatGroupId: groupOfId.get(q.id) ?? null }));
}

// ─── Topic Weight ───────────────────────────────────────────────

/**
 * Topic weight = total marks of its questions ÷ number of papers in the subject.
 * Questions with marks: null count 0 marks but still count as asked.
 */
export function topicWeight(
  topicId: string,
  questions: Question[],
  paperCount: number,
): number {
  if (paperCount <= 0) return 0;
  const topicQs = questions.filter((q) => q.topicId === topicId);
  const totalMarks = topicQs.reduce((sum, q) => sum + (q.marks ?? 0), 0);
  return totalMarks / paperCount;
}

// ─── Unit Weight ────────────────────────────────────────────────

/**
 * Unit weight = sum of its topic weights.
 */
export function unitWeight(
  unit: Unit,
  questions: Question[],
  paperCount: number,
): number {
  if (paperCount <= 0) return 0;
  return unit.topics.reduce(
    (sum, t) => sum + topicWeight(t.id, questions, paperCount),
    0,
  );
}

// ─── High Priority Badge ────────────────────────────────────────

/**
 * High priority = units in the top third by weight (at least one unit with weight > 0).
 * Returns a Set of unit IDs that are high priority.
 */
export function highPriorityUnitIds(
  units: Unit[],
  questions: Question[],
  paperCount: number,
): Set<string> {
  if (units.length === 0 || paperCount <= 0) return new Set();

  const weights = units.map((u) => ({
    id: u.id,
    weight: unitWeight(u, questions, paperCount),
  }));

  // Sort descending by weight
  weights.sort((a, b) => b.weight - a.weight);

  // Top third, at least 1
  const topCount = Math.max(1, Math.ceil(units.length / 3));

  const prioritySet = new Set<string>();
  for (let i = 0; i < topCount && i < weights.length; i++) {
    if (weights[i].weight > 0) {
      prioritySet.add(weights[i].id);
    }
  }

  return prioritySet;
}

// ─── Default Sort ───────────────────────────────────────────────

/**
 * Default sort in a topic and in All questions:
 * marks (desc), then times asked (desc), then most recent year (desc).
 * Questions with marks: null sort last.
 */
export function defaultSort(
  questions: Question[],
  allQuestions: Question[] = questions,
): Question[] {
  const groups = groupIndex(allQuestions);
  return [...questions].sort((a, b) => {
    // 1. Marks desc (null sorts last)
    const marksA = a.marks ?? -Infinity;
    const marksB = b.marks ?? -Infinity;
    if (marksB !== marksA) return marksB - marksA;

    // 2. Times asked desc
    const taA = timesAsked(a, allQuestions, groups);
    const taB = timesAsked(b, allQuestions, groups);
    if (taB !== taA) return taB - taA;

    // 3. Most recent year desc
    const yearA = a.year ?? -Infinity;
    const yearB = b.year ?? -Infinity;
    return yearB - yearA;
  });
}

// ─── Sort Options for All Questions ─────────────────────────────

export type SortOption = 'default' | 'marks' | 'timesAsked' | 'year' | 'unitOrder';

export function sortQuestions(
  questions: Question[],
  allQuestions: Question[],
  sortBy: SortOption,
  units: Unit[] = [],
): Question[] {
  const sorted = [...questions];
  const groups = groupIndex(allQuestions);
  switch (sortBy) {
    case 'timesAsked':
      return sorted.sort((a, b) => {
        const taDiff = timesAsked(b, allQuestions, groups) - timesAsked(a, allQuestions, groups);
        if (taDiff !== 0) return taDiff;
        return (b.marks ?? -Infinity) - (a.marks ?? -Infinity);
      });
    case 'year':
      return sorted.sort((a, b) => {
        const ya = a.year ?? -Infinity;
        const yb = b.year ?? -Infinity;
        if (yb !== ya) return yb - ya;
        return (b.marks ?? -Infinity) - (a.marks ?? -Infinity);
      });
    case 'unitOrder': {
      const unitOrderMap = new Map<string, number>();
      units.forEach((u, i) => unitOrderMap.set(u.id, u.order ?? i));
      return sorted.sort((a, b) => {
        const orderA = a.unitId ? (unitOrderMap.get(a.unitId) ?? 999) : 999;
        const orderB = b.unitId ? (unitOrderMap.get(b.unitId) ?? 999) : 999;
        if (orderA !== orderB) return orderA - orderB;
        return (b.marks ?? -Infinity) - (a.marks ?? -Infinity);
      });
    }
    default: // 'marks' and 'default': marks, then times asked, then year (§9)
      return defaultSort(questions, allQuestions);
  }
}

// ─── Filters ────────────────────────────────────────────────────

export type QuestionFilters = {
  unitId?: string | null;
  type?: Question['type'] | null;
  marksRange?: 'low' | 'mid' | 'high' | null; // low=≤2, mid=3-5, high=10+
  year?: number | null;
  needsReview?: boolean;
};

export function filterQuestions(
  questions: Question[],
  filters: QuestionFilters,
): Question[] {
  let result = questions;

  if (filters.unitId) {
    if (filters.unitId === 'unassigned') {
      result = result.filter((q) => q.topicId === null);
    } else {
      result = result.filter((q) => q.unitId === filters.unitId);
    }
  }

  if (filters.type) {
    result = result.filter((q) => q.type === filters.type);
  }

  if (filters.marksRange) {
    result = result.filter((q) => {
      if (q.marks === null) return false;
      switch (filters.marksRange) {
        case 'low':
          return q.marks <= 2;
        case 'mid':
          return q.marks >= 3 && q.marks <= 5;
        case 'high':
          return q.marks >= 10;
        default:
          return true;
      }
    });
  }

  if (filters.year) {
    result = result.filter((q) => q.year === filters.year);
  }

  if (filters.needsReview) {
    result = result.filter((q) => q.needsReview);
  }

  return result;
}

// ─── Helpers for UI ─────────────────────────────────────────────

/**
 * Get distinct sorted descending years from questions.
 */
export function distinctYears(questions: Question[]): number[] {
  const years = new Set<number>();
  for (const q of questions) {
    if (q.year !== null) years.add(q.year);
  }
  return Array.from(years).sort((a, b) => b - a);
}

/**
 * Maximum unit weight (used to normalize weight bar widths in UI).
 */
export function maxUnitWeight(
  units: Unit[],
  questions: Question[],
  paperCount: number,
): number {
  if (units.length === 0 || paperCount <= 0) return 0;
  const weights = units.map((u) => unitWeight(u, questions, paperCount));
  return Math.max(...weights, 0);
}
