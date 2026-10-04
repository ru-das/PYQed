import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  timesAsked,
  askedYears,
  collapseRepeats,
  findRepeats,
  topicWeight,
  unitWeight,
  highPriorityUnitIds,
  defaultSort,
  sortQuestions,
  filterQuestions,
  distinctYears,
  maxUnitWeight,
} from '../ranking';
import { Question, Unit } from '../subject';

function createTestQuestion(overrides: Partial<Question> & { id: string }): Question {
  return {
    paperId: 'p1',
    year: 2023,
    page: 1,
    number: '1',
    text: 'Explain binary search trees.',
    marks: 5,
    type: 'long',
    unitId: null,
    topicId: null,
    topicConfidence: null,
    repeatGroupId: null,
    needsReview: false,
    editedByUser: false,
    isOrAlternative: false,
    group: undefined,
    ...overrides,
  };
}

describe('timesAsked (AGENTS.md §9)', () => {
  it('returns 1 when repeatGroupId is null', () => {
    const q1 = createTestQuestion({ id: 'q1' });
    assert.strictEqual(timesAsked(q1, [q1]), 1);
  });

  it('counts distinct papers in the same repeat group', () => {
    const all = [
      createTestQuestion({ id: 'q1', paperId: 'p1', repeatGroupId: 'rg1' }),
      createTestQuestion({ id: 'q2', paperId: 'p2', repeatGroupId: 'rg1' }),
      createTestQuestion({ id: 'q3', paperId: 'p3', repeatGroupId: 'rg1' }),
      createTestQuestion({ id: 'q4', paperId: 'p1', repeatGroupId: 'rg1' }), // duplicate in p1
    ];
    // Distinct papers are p1, p2, p3 -> 3
    assert.strictEqual(timesAsked(all[0], all), 3);
  });
});

describe('topicWeight', () => {
  it('computes total marks / paperCount', () => {
    const qs = [
      createTestQuestion({ id: 'q1', topicId: 't1', marks: 5 }),
      createTestQuestion({ id: 'q2', topicId: 't1', marks: 10 }),
      createTestQuestion({ id: 'q3', topicId: 't2', marks: 4 }),
    ];
    assert.strictEqual(topicWeight('t1', qs, 2), 7.5);
  });

  it('treats null marks as 0 without error', () => {
    const qs = [
      createTestQuestion({ id: 'q1', topicId: 't1', marks: null }),
      createTestQuestion({ id: 'q2', topicId: 't1', marks: 6 }),
    ];
    assert.strictEqual(topicWeight('t1', qs, 2), 3);
  });

  it('returns 0 when paperCount is 0 or negative', () => {
    assert.strictEqual(topicWeight('t1', [], 0), 0);
    assert.strictEqual(topicWeight('t1', [], -1), 0);
  });
});

describe('unitWeight (AGENTS.md §9)', () => {
  it('sums the topic weights of all topics in a unit', () => {
    const unit: Unit = {
      id: 'u1',
      name: 'Unit 1: Trees & Graphs',
      order: 0,
      topics: [
        { id: 't1', name: 'Trees' },
        { id: 't2', name: 'Graphs' },
      ],
    };
    const qs = [
      createTestQuestion({ id: 'q1', topicId: 't1', marks: 10 }),
      createTestQuestion({ id: 'q2', topicId: 't2', marks: 6 }),
    ];
    // (10/2) + (6/2) = 5 + 3 = 8
    assert.strictEqual(unitWeight(unit, qs, 2), 8);
  });

  it('returns 0 when paperCount is 0', () => {
    const unit: Unit = {
      id: 'u1',
      name: 'Unit 1',
      order: 0,
      topics: [{ id: 't1', name: 'T1' }],
    };
    assert.strictEqual(unitWeight(unit, [], 0), 0);
  });
});

describe('highPriorityUnitIds (AGENTS.md §9)', () => {
  it('marks top third by weight as high priority', () => {
    const units: Unit[] = [
      { id: 'u1', name: 'U1', order: 0, topics: [{ id: 't1', name: 'T1' }] },
      { id: 'u2', name: 'U2', order: 1, topics: [{ id: 't2', name: 'T2' }] },
      { id: 'u3', name: 'U3', order: 2, topics: [{ id: 't3', name: 'T3' }] },
    ];
    const qs = [
      createTestQuestion({ id: 'q1', topicId: 't1', marks: 25 }),
      createTestQuestion({ id: 'q2', topicId: 't2', marks: 10 }),
      createTestQuestion({ id: 'q3', topicId: 't3', marks: 2 }),
    ];
    const highPriority = highPriorityUnitIds(units, qs, 1);
    // 3 units -> ceil(3/3) = 1 top unit
    assert.strictEqual(highPriority.size, 1);
    assert.ok(highPriority.has('u1'));
    assert.ok(!highPriority.has('u2'));
    assert.ok(!highPriority.has('u3'));
  });

  it('includes at least one unit when weight > 0', () => {
    const units: Unit[] = [
      { id: 'u1', name: 'U1', order: 0, topics: [{ id: 't1', name: 'T1' }] },
    ];
    const qs = [createTestQuestion({ id: 'q1', topicId: 't1', marks: 5 })];
    const highPriority = highPriorityUnitIds(units, qs, 1);
    assert.strictEqual(highPriority.size, 1);
    assert.ok(highPriority.has('u1'));
  });

  it('returns empty set if all units have 0 weight', () => {
    const units: Unit[] = [
      { id: 'u1', name: 'U1', order: 0, topics: [{ id: 't1', name: 'T1' }] },
    ];
    const highPriority = highPriorityUnitIds(units, [], 1);
    assert.strictEqual(highPriority.size, 0);
  });
});

describe('defaultSort (AGENTS.md §9)', () => {
  it('sorts by marks (desc), then times asked (desc), then most recent year (desc)', () => {
    const qs = [
      createTestQuestion({ id: 'q1', marks: 5, year: 2020 }),
      createTestQuestion({ id: 'q2', marks: 10, year: 2019 }),
      createTestQuestion({ id: 'q3', marks: 5, year: 2023 }),
      createTestQuestion({ id: 'q4', marks: null, year: 2024 }),
      createTestQuestion({ id: 'q5', marks: 5, year: 2020, repeatGroupId: 'rg1' }),
      createTestQuestion({ id: 'q5_b', paperId: 'p2', repeatGroupId: 'rg1' }),
    ];

    const sorted = defaultSort([qs[0], qs[1], qs[2], qs[3], qs[4]], qs);

    // 1st: q2 (10 marks)
    assert.strictEqual(sorted[0].id, 'q2');
    // 2nd: q5 (5 marks, asked 2x because of rg1)
    assert.strictEqual(sorted[1].id, 'q5');
    // 3rd: q3 (5 marks, year 2023, asked 1x)
    assert.strictEqual(sorted[2].id, 'q3');
    // 4th: q1 (5 marks, year 2020, asked 1x)
    assert.strictEqual(sorted[3].id, 'q1');
    // 5th: q4 (null marks sorts last)
    assert.strictEqual(sorted[4].id, 'q4');
  });
});

describe('sortQuestions with options', () => {
  const qs = [
    createTestQuestion({ id: 'q1', marks: 2, year: 2021, unitId: 'u2' }),
    createTestQuestion({ id: 'q2', marks: 10, year: 2020, unitId: 'u1' }),
    createTestQuestion({ id: 'q3', marks: 5, year: 2023, unitId: 'u1' }),
  ];
  const units: Unit[] = [
    { id: 'u1', name: 'Unit 1', order: 0, topics: [] },
    { id: 'u2', name: 'Unit 2', order: 1, topics: [] },
  ];

  it('sorts by marks', () => {
    const sorted = sortQuestions(qs, qs, 'marks', units);
    assert.strictEqual(sorted[0].id, 'q2'); // 10
    assert.strictEqual(sorted[1].id, 'q3'); // 5
    assert.strictEqual(sorted[2].id, 'q1'); // 2
  });

  it('sorts by year', () => {
    const sorted = sortQuestions(qs, qs, 'year', units);
    assert.strictEqual(sorted[0].id, 'q3'); // 2023
    assert.strictEqual(sorted[1].id, 'q1'); // 2021
    assert.strictEqual(sorted[2].id, 'q2'); // 2020
  });

  it('sorts by unitOrder', () => {
    const sorted = sortQuestions(qs, qs, 'unitOrder', units);
    assert.ok(sorted[0].unitId === 'u1');
    assert.ok(sorted[1].unitId === 'u1');
    assert.ok(sorted[2].unitId === 'u2');
  });
});

describe('filterQuestions', () => {
  const qs = [
    createTestQuestion({ id: 'q1', unitId: 'u1', topicId: 't1', type: 'short', marks: 2, year: 2023, needsReview: false }),
    createTestQuestion({ id: 'q2', unitId: 'u2', topicId: 't2', type: 'long', marks: 10, year: 2022, needsReview: true }),
    createTestQuestion({ id: 'q3', unitId: 'u1', topicId: 't1', type: 'mcq', marks: 1, year: 2023, needsReview: false }),
    createTestQuestion({ id: 'q4', unitId: null, topicId: null, type: 'other', marks: null, year: null, needsReview: true }),
  ];

  it('filters by unitId', () => {
    assert.strictEqual(filterQuestions(qs, { unitId: 'u1' }).length, 2);
  });

  it('filters by unassigned', () => {
    assert.strictEqual(filterQuestions(qs, { unitId: 'unassigned' }).length, 1);
  });

  it('filters by type', () => {
    assert.strictEqual(filterQuestions(qs, { type: 'mcq' }).length, 1);
  });

  it('filters by marksRange (low, mid, high)', () => {
    assert.strictEqual(filterQuestions(qs, { marksRange: 'low' }).length, 2); // 2m and 1m
    assert.strictEqual(filterQuestions(qs, { marksRange: 'high' }).length, 1); // 10m
    assert.strictEqual(filterQuestions(qs, { marksRange: 'mid' }).length, 0);
  });

  it('filters by year', () => {
    assert.strictEqual(filterQuestions(qs, { year: 2023 }).length, 2);
  });

  it('filters by needsReview', () => {
    assert.strictEqual(filterQuestions(qs, { needsReview: true }).length, 2);
  });
});

describe('distinctYears, maxUnitWeight', () => {
  it('returns distinct descending years', () => {
    const qs = [
      createTestQuestion({ id: 'q1', year: 2022 }),
      createTestQuestion({ id: 'q2', year: 2024 }),
      createTestQuestion({ id: 'q3', year: 2022 }),
      createTestQuestion({ id: 'q4', year: null }),
    ];
    assert.deepStrictEqual(distinctYears(qs), [2024, 2022]);
  });

  it('calculates max unit weight correctly', () => {
    const units: Unit[] = [
      { id: 'u1', name: 'U1', order: 0, topics: [{ id: 't1', name: 'T1' }] },
      { id: 'u2', name: 'U2', order: 1, topics: [{ id: 't2', name: 'T2' }] },
    ];
    const qs = [
      createTestQuestion({ id: 'q1', topicId: 't1', marks: 10 }),
      createTestQuestion({ id: 'q2', topicId: 't2', marks: 20 }),
    ];
    assert.strictEqual(maxUnitWeight(units, qs, 1), 20);
  });
});

describe('repeat groups (AGENTS.md §8.4)', () => {
  it('timesAsked is 1 for a dangling group with a single member', () => {
    const q = createTestQuestion({ id: 'q1', repeatGroupId: 'gone' });
    assert.strictEqual(timesAsked(q, [q]), 1);
  });

  it('askedYears returns distinct sorted non-null years of the group', () => {
    const all = [
      createTestQuestion({ id: 'a', paperId: 'p1', year: 2021, repeatGroupId: 'g' }),
      createTestQuestion({ id: 'b', paperId: 'p2', year: 2019, repeatGroupId: 'g' }),
      createTestQuestion({ id: 'c', paperId: 'p3', year: null, repeatGroupId: 'g' }),
      createTestQuestion({ id: 'd', paperId: 'p4', year: 2019, repeatGroupId: 'g' }),
    ];
    assert.deepStrictEqual(askedYears(all[0], all), [2019, 2021]);
    const solo = createTestQuestion({ id: 's', year: 2023 });
    assert.deepStrictEqual(askedYears(solo, [solo]), [2023]);
  });

  it('collapseRepeats: one entry per group, newest wording first, order kept', () => {
    const qs = [
      createTestQuestion({ id: 'x', year: 2020 }),
      createTestQuestion({ id: 'a', year: 2019, repeatGroupId: 'g' }),
      createTestQuestion({ id: 'y', year: 2018 }),
      createTestQuestion({ id: 'b', year: 2022, repeatGroupId: 'g' }),
    ];
    const out = collapseRepeats(qs).map((g) => g.map((q) => q.id));
    assert.deepStrictEqual(out, [['x'], ['b', 'a'], ['y']]);
  });

  it('findRepeats groups the same wording across different years', () => {
    const qs = [
      createTestQuestion({ id: 'a', paperId: 'p1', year: 2019, text: 'Define a stack.' }),
      createTestQuestion({ id: 'b', paperId: 'p2', year: 2022, text: 'define  a STACK' }),
      createTestQuestion({ id: 'c', paperId: 'p3', year: 2022, text: 'Define a queue.' }),
    ];
    const byId = Object.fromEntries(findRepeats(qs).map((q) => [q.id, q.repeatGroupId]));
    assert.strictEqual(byId.a, 'a');
    assert.strictEqual(byId.b, 'a');
    assert.strictEqual(byId.c, null);
  });

  it('findRepeats ignores the same wording within one year', () => {
    const qs = [
      createTestQuestion({ id: 'a', paperId: 'p1', year: 2020, text: 'Define a stack.' }),
      createTestQuestion({ id: 'b', paperId: 'p2', year: 2020, text: 'Define a stack.' }),
    ];
    assert.ok(findRepeats(qs).every((q) => q.repeatGroupId === null));
  });

  it('findRepeats clears stale group ids', () => {
    const qs = [createTestQuestion({ id: 'a', repeatGroupId: 'old' })];
    assert.strictEqual(findRepeats(qs)[0].repeatGroupId, null);
  });
});
