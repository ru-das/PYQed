/**
 * Question topic labelling orchestrator.
 * Runs after a paper is saved. Sends questions in chunks of ≤ 25 to the AI.
 * Labels each question with a topic ID; unknown topic IDs -> null (Unassigned).
 * unitId is derived from the topic by code.
 * Callers only pass questions with no topic yet, so a topic the user set by hand is never overwritten.
 */

import { Provider } from '../config';
import { generateJSON, streamProgress, StreamProgress, countMatches } from './client';
import { topicLabelsPrompt } from './prompts';
import { runResumable } from './resume';
import { validateTopicLabels, RawTopicLabel, TopicLabelsResponse } from './validators';
import { Subject, Question, Unit } from '../logic/subject';

export type LabelProgress = {
  current: number; // chunk number
  total: number; // total chunks
  message: string;
  live?: StreamProgress;
};

const CHUNK_SIZE = 25;

/** Joins label parts for one chunk; a question labelled twice keeps its first label. */
function mergeLabels(parts: TopicLabelsResponse[]): TopicLabelsResponse {
  const seen = new Set<string>();
  return { labels: parts.flatMap((p) => p.labels).filter((l) => !seen.has(l.q) && !!seen.add(l.q)) };
}

/**
 * Build compact topic list "T1 | UnitName | TopicName".
 * The real IDs (timestamp-based, nearly identical to each other) are easy for
 * the model to garble when copying them back, so the prompt uses short aliases
 * and code maps them back.
 */
export function buildTopicList(units: Unit[]): { text: string; aliasToId: Map<string, string> } {
  const lines: string[] = [];
  const aliasToId = new Map<string, string>();
  for (const unit of units) {
    for (const topic of unit.topics) {
      const alias = `T${aliasToId.size + 1}`;
      aliasToId.set(alias, topic.id);
      lines.push(`${alias} | ${unit.name} | ${topic.name}`);
    }
  }
  return { text: lines.join('\n'), aliasToId };
}

/**
 * Build question list "Q1 | QuestionText" with short aliases (see buildTopicList).
 */
export function buildQuestionList(questions: Question[]): { text: string; aliasToId: Map<string, string> } {
  const aliasToId = new Map<string, string>();
  const text = questions
    .map((q, i) => {
      const alias = `Q${i + 1}`;
      aliasToId.set(alias, q.id);
      return `${alias} | ${q.text.slice(0, 300).replace(/\r?\n/g, ' ')}`;
    })
    .join('\n');
  return { text, aliasToId };
}

/**
 * Look up an alias the model returned. Tolerates case, whitespace, a bare number ("3"),
 * trailing text ("T3 | Unit 1 | Graphs", "Q3.") by taking the first number and re-adding the prefix.
 */
export function resolveAlias(map: Map<string, string>, raw: string | number | null, prefix: 'T' | 'Q'): string | null {
  const m = raw === null ? null : String(raw).match(/(\d+)/);
  return m ? map.get(`${prefix}${parseInt(m[1], 10)}`) ?? null : null;
}

/**
 * Find the unitId for a given topicId by scanning the subject's units.
 */
export function findUnitIdForTopic(units: Unit[], topicId: string): string | null {
  for (const unit of units) {
    if (unit.topics.some((t) => t.id === topicId)) {
      return unit.id;
    }
  }
  return null;
}

/**
 * Label questions with topic IDs using AI (§8.3).
 * Returns the full questions array with new labels applied, plus the first error message
 * (if any chunk failed) so the caller can tell the user why questions stayed unassigned.
 *
 * editedByUser is deliberately NOT checked: it is set by ANY edit (marks, typo...) in review.
 * A topic the user set by hand can't be overwritten anyway, because callers only pass
 * brand-new questions or ones with topicId === null.
 */
export async function labelQuestions(
  subject: Subject,
  questionIds: string[],
  provider: Provider,
  apiKey: string,
  modelId: string,
  onProgress?: (p: LabelProgress) => void,
  signal?: AbortSignal,
): Promise<{ questions: Question[]; error?: string }> {
  if (subject.units.length === 0) {
    // No syllabus units exist; questions remain unassigned
    return { questions: subject.questions };
  }

  const topics = buildTopicList(subject.units);
  if (!topics.text.trim()) {
    return { questions: subject.questions };
  }

  const targetIdSet = new Set(questionIds);
  const questionsToLabel = subject.questions.filter((q) => targetIdSet.has(q.id));

  if (questionsToLabel.length === 0) {
    return { questions: subject.questions };
  }

  let error: string | undefined;

  // Chunk into groups of <= 25
  const chunks: Question[][] = [];
  for (let i = 0; i < questionsToLabel.length; i += CHUNK_SIZE) {
    chunks.push(questionsToLabel.slice(i, i + CHUNK_SIZE));
  }

  const labelMap = new Map<
    string,
    { topicId: string | null; confidence: 'high' | 'low' }
  >();

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const msg = `Labelling questions ${i * CHUNK_SIZE + 1}–${Math.min(
      (i + 1) * CHUNK_SIZE,
      questionsToLabel.length,
    )} of ${questionsToLabel.length}...`;
    onProgress?.({ current: i + 1, total: chunks.length, message: msg });

    try {
      // If the provider stops the answer midway, the labels already written are kept and only the
      // questions without a label are asked again. Parts hold real question IDs, so they merge by ID.
      const { res, parts } = await runResumable<TopicLabelsResponse>({
        call: async (soFar) => {
          const done = new Set(soFar?.labels.map((l) => l.q));
          const questions = buildQuestionList(chunk.filter((q) => !done.has(q.id)));
          const toReal = (d: TopicLabelsResponse): TopicLabelsResponse => ({
            labels: d.labels.flatMap((l) => {
              const id = resolveAlias(questions.aliasToId, l.q, 'Q');
              return id ? [{ ...l, q: id }] : [];
            }),
          });
          const r = await generateJSON<TopicLabelsResponse>({
            prompt: topicLabelsPrompt(topics.text, questions.text),
            schemaName: 'topicLabels',
            provider,
            apiKey,
            modelId,
            temperature: 1, // 0 lets Gemma loop on "re-checking" (same as the syllabus call)
            signal,
            onStream: streamProgress(
              (live) => onProgress?.({ current: i + 1, total: chunks.length, message: msg, live }),
              countMatches(/"q"\s*:/g),
            ),
          });
          if (r.ok) return { ...r, data: toReal(r.data) };
          return r.partial ? { ...r, partial: toReal(r.partial) } : r;
        },
        merge: mergeLabels,
        size: (d) => d.labels.length,
      });

      const got = res.ok ? res.data.labels : parts.length ? mergeLabels(parts).labels : [];
      for (const item of got) {
        labelMap.set(item.q, {
          topicId: resolveAlias(topics.aliasToId, item.topic, 'T'), // null if unknown or explicitly null
          confidence: item.confidence,
        });
      }

      if (!res.ok) {
        if (signal?.aborted) break; // stopped by the user: keep the labels found so far, no error note
        error ??= res.friendlyError;
        console.warn('Topic labelling chunk failed:', res.error);
        if (res.fatal) break; // bad key / rate limit / offline: later chunks would fail too
      }
    } catch (e: any) {
      // Non-fatal: those questions stay unassigned, but tell the user why
      error ??= e?.message || 'Something went wrong while sorting questions.';
      console.warn('Topic labelling chunk threw:', e);
    }
  }

  const labelled = subject.questions.map((q) => {
    const label = labelMap.get(q.id);
    if (!label) return q;

    const resolvedUnitId = label.topicId
      ? findUnitIdForTopic(subject.units, label.topicId)
      : null;

    return {
      ...q,
      topicId: label.topicId,
      unitId: resolvedUnitId,
      topicConfidence: label.confidence,
    };
  });
  return { questions: labelled, error };
}
