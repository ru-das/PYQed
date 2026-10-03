/**
 * Repeat-group orchestrator (AGENTS.md §8.4).
 * Runs after labelling. For each topic that received new questions (and has
 * ≥ 2 questions), asks Gemma 4 which questions are essentially the same.
 * Code assigns repeatGroupId; times-asked is computed in ranking.ts.
 */

import { Provider } from '../config';
import { generateJSON } from './client';
import { repeatGroupsPrompt } from './prompts';
import { validateRepeatGroups, RepeatGroupsResponse } from './validators';
import { Subject, Question } from '../logic/subject';
import { applyRepeatGroups } from '../logic/ranking';

export type RepeatProgress = { current: number; total: number; message: string };

/** "QuestionID | year | text" */
function buildQuestionList(questions: Question[]): string {
  return questions
    .map(
      (q) =>
        `${q.id} | ${q.year ?? 'unknown'} | ${q.text.slice(0, 300).replace(/\r?\n/g, ' ')}`,
    )
    .join('\n');
}

/**
 * Returns the full questions array with repeatGroupId updated for affected topics.
 * A topic whose call fails keeps its existing groups (non-fatal).
 */
export async function groupRepeats(
  subject: Subject,
  newQuestionIds: string[],
  provider: Provider,
  apiKey: string,
  modelId: string,
  onProgress?: (p: RepeatProgress) => void,
): Promise<Question[]> {
  const newIds = new Set(newQuestionIds);
  const affectedTopics = new Set<string>();
  for (const q of subject.questions) {
    if (newIds.has(q.id) && q.topicId) affectedTopics.add(q.topicId);
  }

  // Only topics with ≥ 2 questions can contain a repeat
  const jobs = Array.from(affectedTopics)
    .map((topicId) => subject.questions.filter((q) => q.topicId === topicId))
    .filter((qs) => qs.length >= 2);

  let questions = subject.questions;
  for (let i = 0; i < jobs.length; i++) {
    const topicQs = jobs[i];
    onProgress?.({
      current: i + 1,
      total: jobs.length,
      message: `Finding repeated questions (topic ${i + 1} of ${jobs.length})...`,
    });

    try {
      const res = await generateJSON<RepeatGroupsResponse>({
        prompt: repeatGroupsPrompt(buildQuestionList(topicQs)),
        schemaName: 'repeatGroups',
        provider,
        apiKey,
        modelId,
      });
      if (!res.ok) continue;
      const validated = validateRepeatGroups(res.data, new Set(topicQs.map((q) => q.id)));
      if (!validated.ok) continue;
      questions = applyRepeatGroups(
        questions,
        new Set(topicQs.map((q) => q.id)),
        validated.data.groups,
      );
    } catch {
      // Non-fatal: topic keeps its existing groups
    }
  }
  return questions;
}
