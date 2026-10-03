import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTopicList, buildQuestionList, resolveAlias } from '../../ai/labelQuestions';

test('aliases round-trip to real IDs, tolerant of case/space', () => {
  const units: any = [{ id: 'u1', name: 'Unit 1', order: 0, topics: [{ id: 'mfg3k2ab1x9z', name: 'Graphs' }, { id: 'mfg3k2abq7c2', name: 'Trees' }] }];
  const t = buildTopicList(units);
  assert.equal(t.text, 'T1 | Unit 1 | Graphs\nT2 | Unit 1 | Trees');
  assert.equal(resolveAlias(t.aliasToId, ' t2 '), 'mfg3k2abq7c2');
  assert.equal(resolveAlias(t.aliasToId, 'T9'), null);
  assert.equal(resolveAlias(t.aliasToId, null), null);
  const q = buildQuestionList([{ id: 'qa', text: 'x\ny' }] as any);
  assert.equal(q.text, 'Q1 | x y');
  assert.equal(resolveAlias(q.aliasToId, 'Q1'), 'qa');
});
