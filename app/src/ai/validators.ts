/**
 * Hand-written validators for AI responses. AGENTS.md §7:
 * "Always extract, JSON.parse, and validate with a hand-written validator per schema."
 */

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// --- §8.2 Paper Page Questions Types ---

export type RawExtractedQuestion = {
  number: string;
  group: string | null;
  text: string;
  marks: number | null;
  has_options: boolean;
  or_alternative: boolean;
  continues_previous: boolean;
};

export type ExtractedPaperMetadata = {
  year: number | null;
  session: string | null;
  subject_name: string | null;
  subject_code: string | null;
};

export type PageQuestionsResponse = {
  paper: ExtractedPaperMetadata;
  questions: RawExtractedQuestion[];
};

export type ProcessedQuestion = RawExtractedQuestion & {
  type: 'mcq' | 'short' | 'long' | 'other';
  needsReview: boolean;
};

/**
 * Derives question type from marks and options by code (AGENTS.md §8.2):
 * has_options -> mcq
 * marks <= 3  -> short
 * marks > 3   -> long
 * marks null  -> other
 */
export function deriveQuestionType(
  marks: number | null,
  hasOptions: boolean,
): 'mcq' | 'short' | 'long' | 'other' {
  if (hasOptions) return 'mcq';
  if (marks === null) return 'other';
  if (marks <= 3) return 'short';
  return 'long';
}

/**
 * Checks if question needs manual user review (AGENTS.md §8.2):
 * marks === null or text < 10 chars.
 */
export function checkNeedsReview(text: string, marks: number | null): boolean {
  if (marks === null) return true;
  if (text.trim().length < 10) return true;
  return false;
}

export function validatePageQuestions(
  data: unknown,
): ValidationResult<PageQuestionsResponse> {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Response root must be a JSON object' };
  }

  const root = data as Record<string, unknown>;

  // Validate paper metadata
  const paperRaw = root.paper;
  const paper: ExtractedPaperMetadata = {
    year: null,
    session: null,
    subject_name: null,
    subject_code: null,
  };

  if (paperRaw && typeof paperRaw === 'object') {
    const p = paperRaw as Record<string, unknown>;
    if (typeof p.year === 'number' && p.year >= 1900 && p.year <= 2100) {
      paper.year = Math.round(p.year);
    } else if (typeof p.year === 'string' && /^\d{4}$/.test(p.year.trim())) {
      paper.year = parseInt(p.year.trim(), 10);
    }
    if (typeof p.session === 'string' && p.session.trim()) {
      paper.session = p.session.trim();
    }
    if (typeof p.subject_name === 'string' && p.subject_name.trim()) {
      paper.subject_name = p.subject_name.trim();
    }
    if (typeof p.subject_code === 'string' && p.subject_code.trim()) {
      paper.subject_code = p.subject_code.trim();
    }
  }

  // Validate questions array
  if (!Array.isArray(root.questions)) {
    return { ok: false, error: 'Response must contain a "questions" array' };
  }

  const questions: RawExtractedQuestion[] = [];

  for (let i = 0; i < root.questions.length; i++) {
    const item = root.questions[i];
    if (!item || typeof item !== 'object') {
      return { ok: false, error: `Question item at index ${i} is not an object` };
    }

    const q = item as Record<string, unknown>;
    const text = typeof q.text === 'string' ? q.text.trim() : '';
    if (!text) {
      return { ok: false, error: `Question item at index ${i} has empty or missing text` };
    }

    let marks: number | null = null;
    if (typeof q.marks === 'number' && !isNaN(q.marks) && q.marks >= 0) {
      marks = q.marks;
    } else if (typeof q.marks === 'string' && /^\d+(\.\d+)?$/.test(q.marks.trim())) {
      marks = parseFloat(q.marks.trim());
    }

    const number =
      typeof q.number === 'string'
        ? q.number.trim()
        : typeof q.number === 'number'
        ? String(q.number)
        : `Q${i + 1}`;

    const group =
      typeof q.group === 'string' && q.group.trim().length > 0
        ? q.group.trim()
        : null;

    questions.push({
      number: number || `Q${i + 1}`,
      group,
      text,
      marks,
      has_options: q.has_options === true,
      or_alternative: q.or_alternative === true,
      continues_previous: q.continues_previous === true,
    });
  }

  return {
    ok: true,
    data: {
      paper,
      questions,
    },
  };
}

/**
 * Simple validator for the "Test Key" ping call.
 */
function validatePingTest(data: unknown): ValidationResult<{ ok: boolean }> {
  if (data && typeof data === 'object') {
    return { ok: true, data: { ok: true } };
  }
  return { ok: false, error: 'Invalid response from model' };
}

/** Registry of validators */
export const validators: Record<string, (data: unknown) => ValidationResult<any>> = {
  pageQuestions: validatePageQuestions,
  __test: validatePingTest,
};
