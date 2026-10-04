/**
 * Question topic labelling orchestrator.
 * Runs after a paper is saved. Sends questions in chunks of ≤ 25 to the AI.
 * Labels each question with a topic ID; unknown topic IDs -> null (Unassigned).
 * unitId is derived from the topic by code.
 * User edits (editedByUser) are NEVER overwritten.
 */

import { Provider } from '../config';
import { generateJSON, streamProgress, StreamProgress } from './client';
import { topicLabelsPrompt } from './prompts';
import { validateTopicLabels, RawTopicLabel, TopicLabelsResponse } from './validators';
import { Subject, Question, Unit } from '../logic/subject';

export type LabelProgress = {
  current: number; // chunk number
  total: number; // total chunks
  message: string;
  live?: StreamProgress;
};

const CHUNK_SIZE = 25;

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

/** Look up an alias the model returned, tolerating case and stray whitespace. */
export function resolveAlias(map: Map<string, string>, raw: string | null): string | null {
  return raw ? map.get(raw.trim().toUpperCase()) ?? null : null;
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
 * Only labels questions in questionIds that have not had their topic edited by user.
 * Returns the full questions array with new labels applied.
 */
export async function labelQuestions(
  subject: Subject,
  questionIds: string[],
  provider: Provider,
  apiKey: string,
  modelId: string,
  onProgress?: (p: LabelProgress) => void,
): Promise<Question[]> {
  if (subject.units.length === 0) {
    // No syllabus units exist; questions remain unassigned
    return subject.questions;
  }

  const topics = buildTopicList(subject.units);
  if (!topics.text.trim()) {
    return subject.questions;
  }

  const targetIdSet = new Set(questionIds);

  // Questions to label: must be in target set AND not user-edited
  const questionsToLabel = subject.questions.filter(
    (q) => targetIdSet.has(q.id) && !q.editedByUser,
  );

  if (questionsToLabel.length === 0) {
    return subject.questions;
  }

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

    const questions = buildQuestionList(chunk);

    try {
      const res = await generateJSON<TopicLabelsResponse>({
        prompt: topicLabelsPrompt(topics.text, questions.text),
        schemaName: 'topicLabels',
        provider,
        apiKey,
        modelId,
        onStream: streamProgress(
          (live) => onProgress?.({ current: i + 1, total: chunks.length, message: msg, live }),
          /"q"\s*:/g,
        ),
      });

      const validated = res.ok ? validateTopicLabels(res.data) : null;
      if (validated?.ok) {
        for (const item of validated.data.labels) {
          const qId = resolveAlias(questions.aliasToId, item.q);
          if (!qId) continue;
          labelMap.set(qId, {
            topicId: resolveAlias(topics.aliasToId, item.topic), // null if unknown or explicitly null
            confidence: item.confidence,
          });
        }
      } else {
        console.warn('Topic labelling chunk failed:', res.ok ? (validated as any)?.error : (res as any).error);
      }
    } catch (e) {
      // Non-fatal: if a chunk fails, those questions remain with their existing topic/unassigned
      console.warn('Topic labelling chunk threw:', e);
    }
  }

  // Apply labels without overwriting user edits
  return subject.questions.map((q) => {
    // If question was not in the labelled set or is user edited, leave as is
    if (q.editedByUser) return q;

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
}
