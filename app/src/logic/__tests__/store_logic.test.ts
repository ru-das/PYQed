import { describe, it } from 'node:test';
import assert from 'node:assert';
import { migrate, summarize, summaryLine, Subject } from '../subject';
import { move } from '../list';

const base: Subject = {
  id: 'a', name: 'A', units: [{ id: 'u', name: 'U', order: 0, topics: [] }],
  papers: [], questions: [], practice: {}, version: 1,
};

describe('migrate', () => {
  it('treats missing version as 1 and fills defaults', () => {
    const s = migrate({ id: 'x', name: 'X' });
    assert.strictEqual(s.version, 1);
    assert.deepStrictEqual(s.units, []);
  });
  it('rejects newer versions and non-objects', () => {
    assert.throws(() => migrate({ version: 99 }), /newer/);
    assert.throws(() => migrate(null));
  });
});

describe('summarize', () => {
  it('counts and finds year range, ignoring null years', () => {
    const q = (year: number | null) => ({ year } as any);
    const s = { ...base, questions: [q(2019), q(null), q(2024)] };
    assert.deepStrictEqual(summarize(s), { unitCount: 1, questionCount: 3, yearMin: 2019, yearMax: 2024 });
    assert.strictEqual(summaryLine(summarize(s)), '1 unit · 3 questions · 2019–2024');
  });
  it('omits years when none', () => {
    assert.strictEqual(summaryLine(summarize(base)), '1 unit · 0 questions');
  });
});

describe('move', () => {
  it('swaps and no-ops at edges', () => {
    assert.deepStrictEqual(move([1, 2, 3], 1, -1), [2, 1, 3]);
    assert.deepStrictEqual(move([1, 2, 3], 2, 1), [1, 2, 3]);
    assert.deepStrictEqual(move([1, 2, 3], 0, -1), [1, 2, 3]);
  });
});
