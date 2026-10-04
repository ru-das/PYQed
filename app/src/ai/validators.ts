/**
 * Hand-written validators for AI responses: extract the JSON, parse it, then check its shape here.
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

/**
 * Derives question type from marks and options by code:
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
 * Checks if question needs manual user review:
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

// --- §8.1 Syllabus Structure Types & Validator ---

export type RawSyllabusTopic = {
  name: string;
  details?: string;
};

export type RawSyllabusUnit = {
  name: string;
  topics: RawSyllabusTopic[];
};

export type RawSyllabusSubject = {
  name: string;
  code: string | null;
  units: RawSyllabusUnit[];
};

export type SyllabusStructureResponse = {
  subjects: RawSyllabusSubject[];
};

export function validateSyllabusStructure(
  data: unknown,
): ValidationResult<SyllabusStructureResponse> {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Response root must be a JSON object' };
  }

  const root = data as Record<string, unknown>;

  if (!Array.isArray(root.subjects)) {
    return { ok: false, error: 'Response must contain a "subjects" array' };
  }

  if (root.subjects.length === 0) {
    return { ok: false, error: 'No subjects found in syllabus' };
  }

  if (root.subjects.length > 30) {
    return { ok: false, error: `Too many subjects: ${root.subjects.length} (max 30)` };
  }

  const subjects: RawSyllabusSubject[] = [];

  for (let i = 0; i < root.subjects.length; i++) {
    const rawSub = root.subjects[i];
    if (!rawSub || typeof rawSub !== 'object') {
      return { ok: false, error: `Subject at index ${i} is not an object` };
    }

    const s = rawSub as Record<string, unknown>;
    const name = typeof s.name === 'string' ? s.name.trim().slice(0, 200) : '';
    if (!name) {
      return { ok: false, error: `Subject at index ${i} is missing a name` };
    }

    let code: string | null = null;
    if (typeof s.code === 'string' && s.code.trim().length > 0) {
      code = s.code.trim().slice(0, 50);
    }

    const unitsRaw = Array.isArray(s.units) ? s.units : [];
    if (unitsRaw.length > 20) {
      return { ok: false, error: `Subject "${name}" has too many units (max 20)` };
    }

    const units: RawSyllabusUnit[] = [];

    for (let j = 0; j < unitsRaw.length; j++) {
      const rawU = unitsRaw[j];
      if (!rawU || typeof rawU !== 'object') continue;

      const u = rawU as Record<string, unknown>;
      const uName = typeof u.name === 'string' ? u.name.trim().slice(0, 200) : '';
      if (!uName) continue; // skip unnamed units

      const topicsRaw = Array.isArray(u.topics) ? u.topics : [];
      if (topicsRaw.length > 40) {
        return { ok: false, error: `Unit "${uName}" has too many topics (max 40)` };
      }

      const topics: RawSyllabusTopic[] = [];
      for (let k = 0; k < topicsRaw.length; k++) {
        const rawT = topicsRaw[k];
        if (!rawT || typeof rawT !== 'object') continue;

        const t = rawT as Record<string, unknown>;
        const tName = typeof t.name === 'string' ? t.name.trim().slice(0, 300) : '';
        if (!tName) continue;

        let details: string | undefined = undefined;
        if (typeof t.details === 'string' && t.details.trim().length > 0) {
          details = t.details.trim().slice(0, 200);
        }

        topics.push({ name: tName, details });
      }

      units.push({ name: uName, topics });
    }

    subjects.push({ name, code, units });
  }

  if (subjects.length === 0) {
    return { ok: false, error: 'No valid subjects found after parsing' };
  }

  return {
    ok: true,
    data: { subjects },
  };
}

// --- §8.3 Topic Labels Types & Validator ---

export type RawTopicLabel = {
  q: string; // question ID
  topic: string | null; // topic ID or null
  confidence: 'high' | 'low';
};

export type TopicLabelsResponse = {
  labels: RawTopicLabel[];
};

export function validateTopicLabels(
  data: unknown,
  validQuestionIds?: Set<string>,
  validTopicIds?: Set<string>,
): ValidationResult<TopicLabelsResponse> {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Response root must be a JSON object' };
  }
  const root = data as Record<string, unknown>;
  if (!Array.isArray(root.labels)) {
    return { ok: false, error: 'Response must contain a "labels" array' };
  }

  const labels: RawTopicLabel[] = [];
  for (let i = 0; i < root.labels.length; i++) {
    const item = root.labels[i];
    if (!item || typeof item !== 'object') continue;
    const l = item as Record<string, unknown>;
    // Models sometimes return bare numbers instead of "Q3" / "T3"
    const q = typeof l.q === 'string' || typeof l.q === 'number' ? String(l.q).trim() : '';
    if (!q) continue;
    if (validQuestionIds && !validQuestionIds.has(q)) continue;

    let topic: string | null = null;
    if ((typeof l.topic === 'string' || typeof l.topic === 'number') && String(l.topic).trim()) {
      topic = String(l.topic).trim();
      if (validTopicIds && !validTopicIds.has(topic)) {
        topic = null;
      }
    }

    const confidence: 'high' | 'low' =
      l.confidence === 'low' ? 'low' : 'high';

    labels.push({ q, topic, confidence });
  }

  // An empty answer is useless: fail so generateJSON retries once
  if (labels.length === 0) {
    return { ok: false, error: 'No usable labels in response' };
  }
  return { ok: true, data: { labels } };
}

/** Registry of validators */
export const validators: Record<string, (data: unknown) => ValidationResult<any>> = {
  pageQuestions: validatePageQuestions,
  syllabusStructure: validateSyllabusStructure,
  topicLabels: (data) => validateTopicLabels(data),
  __test: validatePingTest,
};

