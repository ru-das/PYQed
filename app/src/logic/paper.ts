/**
 * Pure paper import logic.
 * No React Native dependencies — runs in pure Node/tests.
 */

import { RawExtractedQuestion, PageQuestionsResponse, deriveQuestionType, checkNeedsReview } from '../ai/validators';
import { Question, newId } from './subject';

export type NumberingGap = {
  afterQuestion: string;
  beforeQuestion: string;
  page: number;
};

/**
 * Extracts a 4-digit examination year (19xx or 20xx) from a file name.
 * E.g., "CS201_2023_Summer.pdf" -> 2023, "pyq-nov-2019.jpg" -> 2019.
 * Avoids false matches like 4-digit course codes (e.g. CS1001) if possible by checking range 1900-2099.
 */
export function extractYearFromFilename(filename: string): number | null {
  if (!filename) return null;
  // Match 4-digit years between 1950 and 2099 bounded by non-digits
  const matches = filename.match(/(?:^|[^0-9])(19[5-9]\d|20[0-9]\d)(?:[^0-9]|$)/g);
  if (!matches) return null;

  // Extract digits from the last match (often year is at the end or prominent)
  const lastMatch = matches[matches.length - 1];
  const digits = lastMatch.replace(/\D/g, '');
  const parsed = parseInt(digits, 10);
  if (!isNaN(parsed) && parsed >= 1950 && parsed <= 2099) {
    return parsed;
  }
  return null;
}

/**
 * Merges a question that continues from the previous page into the previous page's last question.
 * If currentQuestions[0].continues_previous is true and prevQuestions has at least one question:
 * - Appends current question's text to the last question of prevQuestions.
 * - Removes currentQuestions[0] from currentQuestions.
 */
export function mergeContinuesPrevious<T extends RawExtractedQuestion>(
  prevQuestions: T[],
  currentQuestions: T[],
): { prev: T[]; current: T[] } {
  if (prevQuestions.length === 0 || currentQuestions.length === 0) {
    return { prev: [...prevQuestions], current: [...currentQuestions] };
  }

  const firstCurrent = currentQuestions[0];
  if (!firstCurrent.continues_previous) {
    return { prev: [...prevQuestions], current: [...currentQuestions] };
  }

  const prevCopy = [...prevQuestions];
  const lastPrev = { ...prevCopy[prevCopy.length - 1] };

  // Append text
  lastPrev.text = `${lastPrev.text.trimEnd()} ${firstCurrent.text.trimStart()}`.trim();

  // If previous question didn't have marks but continuation has marks, use them
  if (lastPrev.marks === null && firstCurrent.marks !== null) {
    lastPrev.marks = firstCurrent.marks;
  }

  prevCopy[prevCopy.length - 1] = lastPrev;

  // Remove the merged continuation from current questions
  const currentCopy = currentQuestions.slice(1);

  return {
    prev: prevCopy,
    current: currentCopy,
  };
}

/**
 * Extracts the primary integer question number if present.
 * E.g., "1" -> 1, "Q2a" -> 2, "3(b)(i)" -> 3, "Question 10" -> 10.
 */
export function parseLeadingQuestionNumber(numStr: string): number | null {
  if (!numStr) return null;
  const match = numStr.match(/(?:^|\b|q|Q|question|Question)[.\s-]*(\d+)/);
  if (match && match[1]) {
    const val = parseInt(match[1], 10);
    return isNaN(val) ? null : val;
  }
  return null;
}

/**
 * Detects gaps in question numbering sequence (e.g. 1 -> 3, or 3 -> 5).
 * Only compares questions with positive integer prefixes where the group remains the same.
 */
export function detectNumberingGaps(
  questions: Array<{ number: string; group?: string | null; page: number }>,
): NumberingGap[] {
  const gaps: NumberingGap[] = [];
  if (questions.length < 2) return gaps;

  let prevNumVal: number | null = null;
  let prevNumberStr: string = '';
  let prevGroup: string | null = null;

  for (const q of questions) {
    const currGroup = q.group?.trim().toLowerCase() || null;
    const currNumVal = parseLeadingQuestionNumber(q.number);

    // If we transition to a different group or couldn't parse number, reset baseline
    if (prevGroup !== null && currGroup !== null && prevGroup !== currGroup) {
      prevNumVal = currNumVal;
      prevNumberStr = q.number;
      prevGroup = currGroup;
      continue;
    }

    if (currNumVal !== null) {
      if (prevNumVal !== null) {
        // If current number jumps more than 1 ahead (e.g. 1 -> 3 or 3 -> 5)
        if (currNumVal > prevNumVal + 1) {
          gaps.push({
            afterQuestion: prevNumberStr,
            beforeQuestion: q.number,
            page: q.page,
          });
        }
      }
      prevNumVal = currNumVal;
      prevNumberStr = q.number;
      prevGroup = currGroup;
    }
  }

  return gaps;
}

export type PageQuestionInput = {
  number: string;
  group?: string | null;
  text: string;
  marks: number | null;
  has_options?: boolean;
  or_alternative?: boolean;
  type?: 'mcq' | 'short' | 'long' | 'other';
  needsReview?: boolean;
  editedByUser?: boolean;
};

export type ExtractedPageInput = {
  pageNumber: number;
  questions: PageQuestionInput[];
};

/**
 * Converts reviewed page questions into Question domain models for subject storage.
 */
export function buildQuestionsFromPages(
  pages: ExtractedPageInput[],
  paperId: string,
  year: number | null,
): Question[] {
  const questions: Question[] = [];

  for (const page of pages) {
    for (const q of page.questions) {
      const type = q.type || deriveQuestionType(q.marks, q.has_options ?? false);
      const needsReview = q.needsReview !== undefined ? q.needsReview : checkNeedsReview(q.text, q.marks);

      questions.push({
        id: newId(),
        paperId,
        year,
        page: page.pageNumber,
        number: q.number.trim(),
        group: q.group?.trim() || undefined,
        text: q.text.trim(),
        marks: q.marks,
        type,
        unitId: null,
        topicId: null,
        topicConfidence: null,
        repeatGroupId: null,
        isOrAlternative: q.or_alternative ?? false,
        needsReview,
        editedByUser: q.editedByUser ?? false,
      });
    }
  }

  return questions;
}

/**
 * Joins the answers for one page when the first was stopped midway and the rest was asked for separately.
 * Paper details come from the first part; a question the model repeated (same number and text) is kept once;
 * questions in a later part never continue a question from the page before.
 */
export function mergePageParts(parts: PageQuestionsResponse[]): PageQuestionsResponse {
  const seen = new Set<string>();
  const questions: RawExtractedQuestion[] = [];
  parts.forEach((part, i) => {
    for (const q of part.questions) {
      const key = `${q.number.trim()}|${q.text.trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      questions.push(i > 0 ? { ...q, continues_previous: false } : q);
    }
  });
  return { paper: parts[0].paper, questions };
}
