/**
 * Repeat-group orchestrator.
 * Runs after labelling. For each topic that received new questions (and has >= 2 questions),
 * asks the AI which questions are essentially the same. Several small topics share one call.
 * Code assigns repeatGroupId; times-asked is computed in ranking.ts.
 */

import { Provider } from '../config';
import { generateJSON, streamProgress, StreamProgress } from './client';
import { repeatGroupsPrompt } from './prompts';
import { validateRepeatGroups, RepeatGroupsResponse } from './validators';
import { Subject, Question } from '../logic/subject';
import { applyRepeatGroups } from '../logic/ranking';

export type RepeatProgress = { current: number; total: number; message: string; live?: StreamProgress };

const BATCH_QUESTIONS = 60; // questions per AI call; a single bigger topic still gets its own call

/** Pack per-topic question lists into batches of about `max` questions, never splitting a topic. */
export function packBatches<T>(jobs: T[][], max = BATCH_QUESTIONS): T[][][] {
  const batches: T[][][] = [];
  let current: T[][] = [];
  let size = 0;
  for (const job of jobs) {
    if (current.length && size + job.length > max) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(job);
    size += job.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** Keep only groups whose members are all in the same topic, bucketed by that topic. */
export function groupsByTopic(groups: string[][], topicOf: Map<string, string>): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  for (const g of groups) {
    const topic = topicOf.get(g[0]);
    if (!topic || !g.every((id) => topicOf.get(id) === topic)) continue;
    out.set(topic, [...(out.get(topic) ?? []), g]);
  }
  return out;
}

/**
 * Returns the full questions array with repeatGroupId updated for affected topics.
 * A batch whose call fails keeps its topics' existing groups (non-fatal).
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

  const topicNames = new Map<string, string>();
  for (const u of subject.units) for (const t of u.topics) topicNames.set(t.id, t.name);

  // Only topics with >= 2 questions can contain a repeat
  const jobs = Array.from(affectedTopics)
    .map((topicId) => subject.questions.filter((q) => q.topicId === topicId))
    .filter((qs) => qs.length >= 2);
  const batches = packBatches(jobs);

  let questions = subject.questions;
  for (let i = 0; i < batches.length; i++) {
    const msg = `Finding repeated questions (${i + 1} of ${batches.length})...`;
    onProgress?.({ current: i + 1, total: batches.length, message: msg });

    // Short aliases (Q1, Q2...) instead of the near-identical real IDs, which models garble when copying back
    const aliasToId = new Map<string, string>();
    const topicOfAlias = new Map<string, string>();
    const sections = batches[i].map((topicQs) => {
      const topicId = topicQs[0].topicId as string;
      const lines = topicQs.map((q) => {
        const alias = `Q${aliasToId.size + 1}`;
        aliasToId.set(alias, q.id);
        topicOfAlias.set(alias, topicId);
        return `${alias} | ${q.year ?? 'unknown'} | ${q.text.slice(0, 300).replace(/\r?\n/g, ' ')}`;
      });
      return `Topic: ${topicNames.get(topicId) ?? 'Other'}\n${lines.join('\n')}`;
    });

    try {
      const res = await generateJSON<RepeatGroupsResponse>({
        prompt: repeatGroupsPrompt(sections.join('\n\n')),
        schemaName: 'repeatGroups',
        provider,
        apiKey,
        modelId,
        onStream: streamProgress((live) => onProgress?.({ current: i + 1, total: batches.length, message: msg, live })),
      });
      if (!res.ok) continue;
      const normalised = { groups: res.data.groups.map((g) => g.map((a) => String(a).trim().toUpperCase())) };
      const validated = validateRepeatGroups(normalised, new Set(aliasToId.keys()));
      if (!validated.ok) continue;

      const byTopic = groupsByTopic(validated.data.groups, topicOfAlias);
      for (const topicQs of batches[i]) {
        const topicId = topicQs[0].topicId as string;
        const groups = (byTopic.get(topicId) ?? []).map((g) => g.map((a) => aliasToId.get(a) as string));
        questions = applyRepeatGroups(questions, new Set(topicQs.map((q) => q.id)), groups);
      }
    } catch {
      // Non-fatal: these topics keep their existing groups
    }
  }
  return questions;
}
