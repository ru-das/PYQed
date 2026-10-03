/**
 * Question topic labelling orchestrator (AGENTS.md §8.3).
 * Runs after a paper is saved. Sends questions in chunks of ≤ 25 to Gemma 4.
 * Labels each question with a topic ID; unknown topic IDs -> null (Unassigned).
 * unitId is derived from the topic by code.
 * User edits (editedByUser) are NEVER overwritten.
 */

import { Provider } from '../config';
import { generateJSON } from './client';
import { topicLabelsPrompt } from './prompts';
import { validateTopicLabels, RawTopicLabel, TopicLabelsResponse } from './validators';
import { Subject, Question, Unit } from '../logic/subject';

export type LabelProgress = {
  current: number; // chunk number
  total: number; // total chunks
  message: string;
};

const CHUNK_SIZE = 25;

/**
 * Build compact topic list string: "TopicID | UnitName | TopicName"
 */
function buildTopicList(units: Unit[]): string {
  const lines: string[] = [];
  for (const unit of units) {
    for (const topic of unit.topics) {
      lines.push(`${topic.id} | ${unit.name} | ${topic.name}`);
    }
  }
  return lines.join('\n');
}

/**
 * Build question list string: "QuestionID | QuestionText"
 */
function buildQuestionList(questions: Question[]): string {
  return questions
    .map((q) => `${q.id} | ${q.text.slice(0, 300).replace(/\r?\n/g, ' ')}`)
    .join('\n');
}

/**
 * Collect all valid topic IDs from the subject's units.
 */
function collectTopicIds(units: Unit[]): Set<string> {
  const ids = new Set<string>();
  for (const unit of units) {
    for (const topic of unit.topics) {
      ids.add(topic.id);
    }
  }
  return ids;
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
 * Label questions with topic IDs using Gemma 4 (§8.3).
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

  const topicList = buildTopicList(subject.units);
  if (!topicList.trim()) {
    return subject.questions;
  }

  const validTopicIds = collectTopicIds(subject.units);
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
    onProgress?.({
      current: i + 1,
      total: chunks.length,
      message: `Labelling questions ${i * CHUNK_SIZE + 1}–${Math.min(
        (i + 1) * CHUNK_SIZE,
        questionsToLabel.length,
      )} of ${questionsToLabel.length}...`,
    });

    const questionList = buildQuestionList(chunk);
    const validQIds = new Set(chunk.map((q) => q.id));

    try {
      const res = await generateJSON<TopicLabelsResponse>({
        prompt: topicLabelsPrompt(topicList, questionList),
        schemaName: 'topicLabels',
        provider,
        apiKey,
        modelId,
      });

      if (res.ok) {
        const validated = validateTopicLabels(res.data, validQIds, validTopicIds);
        if (validated.ok) {
          for (const item of validated.data.labels) {
            labelMap.set(item.q, {
              topicId: item.topic, // null if unknown topic or explicitly null
              confidence: item.confidence,
            });
          }
        }
      }
    } catch {
      // Non-fatal: if a chunk fails, those questions remain with their existing topic/unassigned
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
