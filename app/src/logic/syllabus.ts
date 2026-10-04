/**
 * Pure syllabus logic and merging.
 * No React Native dependencies — runs in pure Node/tests.
 */

import {
  RawSyllabusSubject,
  RawSyllabusUnit,
  RawSyllabusTopic,
} from '../ai/validators';

/** Where a chunk of pages ended: its last subject, that subject's last unit and that unit's last topic. */
export type SyllabusPosition = { subject: string; code: string | null; unit: string | null; topic: string | null };

/** Total topics in a list of subjects (to tell whether a continued answer added anything). */
export function countTopics(subjects: RawSyllabusSubject[]): number {
  return subjects.reduce((n, s) => n + s.units.reduce((m, u) => m + u.topics.length, 0), 0);
}

/** Used to tell the model which subject the next chunk of pages probably continues. */
export function lastSyllabusPosition(subjects: RawSyllabusSubject[]): SyllabusPosition | null {
  const last = subjects[subjects.length - 1];
  if (!last) return null;
  const unit = last.units[last.units.length - 1];
  return {
    subject: last.name,
    code: last.code,
    unit: unit ? unit.name : null,
    topic: unit?.topics.length ? unit.topics[unit.topics.length - 1].name : null,
  };
}

/**
 * Merges multiple sets of syllabus subjects by normalized subject name.
 * Combines units with the same normalized name, and prevents duplicate topics.
 */
export function mergeSyllabusSubjects(
  subjectBatches: RawSyllabusSubject[][],
): RawSyllabusSubject[] {
  const mergedMap = new Map<string, RawSyllabusSubject>();

  for (const batch of subjectBatches) {
    for (const sub of batch) {
      const subKey = sub.name.trim().toLowerCase();
      if (!subKey) continue;

      if (!mergedMap.has(subKey)) {
        // Deep copy
        mergedMap.set(subKey, {
          name: sub.name.trim(),
          code: sub.code?.trim() || null,
          units: sub.units.map((u) => ({
            name: u.name.trim(),
            topics: u.topics.map((t) => ({
              name: t.name.trim(),
              details: t.details?.trim(),
            })),
          })),
        });
      } else {
        const existing = mergedMap.get(subKey)!;
        if (!existing.code && sub.code) {
          existing.code = sub.code.trim();
        }

        // Merge units
        for (const unit of sub.units) {
          const uKey = unit.name.trim().toLowerCase();
          if (!uKey) continue;

          const existingUnit = existing.units.find(
            (u) => u.name.trim().toLowerCase() === uKey,
          );

          if (existingUnit) {
            // Merge topics into existing unit
            for (const topic of unit.topics) {
              const tKey = topic.name.trim().toLowerCase();
              if (!tKey) continue;

              const existingTopic = existingUnit.topics.find(
                (t) => t.name.trim().toLowerCase() === tKey,
              );
              if (!existingTopic) {
                existingUnit.topics.push({
                  name: topic.name.trim(),
                  details: topic.details?.trim(),
                });
              } else if (topic.details?.trim()) {
                // Same topic on both sides of a chunk boundary: keep both halves of its details
                const more = topic.details.trim();
                if (!existingTopic.details) existingTopic.details = more;
                else if (!existingTopic.details.includes(more)) existingTopic.details += ` ${more}`;
              }
            }
          } else {
            // Add new unit
            existing.units.push({
              name: unit.name.trim(),
              topics: unit.topics.map((t) => ({
                name: t.name.trim(),
                details: t.details?.trim(),
              })),
            });
          }
        }
      }
    }
  }

  return Array.from(mergedMap.values());
}
