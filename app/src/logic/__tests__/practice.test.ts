import { describe, it } from 'node:test';
import assert from 'node:assert';
import { practicePool, weightedShuffle, recordAnswer, topicProgress } from '../practice';
import { Question, Subject } from '../subject';

function q(overrides: Partial<Question> & { id: string }): Question {
  return {
    paperId: 'p1', year: 2023, page: 1, number: '1', text: 'Explain X.', marks: 5, type: 'long',
    unitId: 'u1', topicId: 't1', topicConfidence: 'high', repeatGroupId: null,
    needsReview: false, editedByUser: false, ...overrides,
  };
}

const subject = (questions: Question[]): Subject => ({
  id: 's', name: 'S', version: 1, practice: {},
  papers: [
    { id: 'p1', year: 2023, sourceName: 'a', pageCount: 1, importedAt: '' },
    { id: 'p2', year: 2024, sourceName: 'b', pageCount: 1, importedAt: '' },
  ],
  units: [
    { id: 'u1', name: 'Unit 1', order: 0, topics: [{ id: 't1', name: 'T1' }, { id: 't2', name: 'T2' }] },
    { id: 'u2', name: 'Unit 2', order: 1, topics: [{ id: 't3', name: 'T3' }] },
    { id: 'u3', name: 'Unit 3', order: 2, topics: [{ id: 't4', name: 'T4' }] },
  ],
  questions,
});

describe('practicePool', () => {
  const qs = [
    q({ id: 'a', topicId: 't1', marks: 10 }),
    q({ id: 'b', topicId: 't2', marks: 2, type: 'short' }),
    q({ id: 'c', topicId: 't3', unitId: 'u2', marks: 1 }),
    q({ id: 'd', topicId: null, unitId: null }),
  ];
  const base = { highPriorityOnly: false, filters: {} };

  it('keeps only selected topics (never unassigned)', () => {
    const pool = practicePool(subject(qs), { ...base, topicIds: new Set(['t1', 't2']) });
    assert.deepStrictEqual(pool.map((x) => x.id).sort(), ['a', 'b']);
  });

  it('applies filters', () => {
    const pool = practicePool(subject(qs), { ...base, topicIds: new Set(['t1', 't2']), filters: { type: 'short' } });
    assert.deepStrictEqual(pool.map((x) => x.id), ['b']);
  });

  it('high priority only keeps the top-third unit', () => {
    // 3 units -> top 1 by weight: u1 (15 marks / 2 papers)
    const pool = practicePool(subject(qs), { ...base, topicIds: new Set(['t1', 't2', 't3']), highPriorityOnly: true });
    assert.deepStrictEqual(pool.map((x) => x.id).sort(), ['a', 'b']);
  });

  it('collapses a repeat group to one card (most recent wording)', () => {
    const rq = [
      q({ id: 'old', year: 2019, repeatGroupId: 'g' }),
      q({ id: 'new', year: 2024, repeatGroupId: 'g' }),
    ];
    const pool = practicePool(subject(rq), { ...base, topicIds: new Set(['t1']) });
    assert.deepStrictEqual(pool.map((x) => x.id), ['new']);
  });
});

describe('weightedShuffle', () => {
  it('is deterministic for a fixed rand and favours revise over got', () => {
    const items = [q({ id: 'got' }), q({ id: 'revise' })];
    const practice = {
      got: { state: 'got' as const, seen: 1 },
      revise: { state: 'revise' as const, seen: 1 },
    };
    // same rand for both: higher weight -> larger key (for rand in (0,1))
    const out = weightedShuffle(items, practice, () => 0.5);
    assert.deepStrictEqual(out.map((x) => x.id), ['revise', 'got']);
  });

  it('keeps every question exactly once', () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => q({ id }));
    assert.strictEqual(new Set(weightedShuffle(items, {}).map((x) => x.id)).size, 4);
  });
});

describe('recordAnswer / topicProgress', () => {
  it('increments seen and sets state without mutating input', () => {
    const p0 = { a: { state: 'revise' as const, seen: 1 } };
    const p1 = recordAnswer(p0, 'a', 'got', new Date('2026-10-03T00:00:00Z'));
    assert.deepStrictEqual(p1.a, { state: 'got', seen: 2, lastSeen: '2026-10-03T00:00:00.000Z' });
    assert.strictEqual(p0.a.seen, 1);
  });

  it('counts practised questions per topic', () => {
    const qs = [q({ id: 'a' }), q({ id: 'b' }), q({ id: 'c', topicId: 't2' })];
    const practice = recordAnswer({}, 'a', 'got');
    assert.deepStrictEqual(topicProgress('t1', qs, practice), { done: 1, total: 2 });
  });
});
