import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTopicLabels } from '../../ai/validators';
import { buildTopicList, buildQuestionList, resolveAlias } from '../../ai/labelQuestions';

test('aliases round-trip to real IDs, tolerant of case/space', () => {
  const units: any = [{ id: 'u1', name: 'Unit 1', order: 0, topics: [{ id: 'mfg3k2ab1x9z', name: 'Graphs' }, { id: 'mfg3k2abq7c2', name: 'Trees' }] }];
  const t = buildTopicList(units);
  assert.equal(t.text, 'T1 | Unit 1 | Graphs\nT2 | Unit 1 | Trees');
  assert.equal(resolveAlias(t.aliasToId, ' t2 ', 'T'), 'mfg3k2abq7c2');
  assert.equal(resolveAlias(t.aliasToId, 'T9', 'T'), null);
  assert.equal(resolveAlias(t.aliasToId, null, 'T'), null);
  const q = buildQuestionList([{ id: 'qa', text: 'x\ny' }] as any);
  assert.equal(q.text, 'Q1 | x y');
  assert.equal(resolveAlias(q.aliasToId, 'Q1', 'Q'), 'qa');
});

test('resolveAlias accepts numbers and decorated aliases', () => {
  const m = new Map([['T3', 'id3']]);
  assert.equal(resolveAlias(m, 3, 'T'), 'id3');
  assert.equal(resolveAlias(m, '3', 'T'), 'id3');
  assert.equal(resolveAlias(m, 'T3 | Unit 1 | Graphs', 'T'), 'id3');
  assert.equal(resolveAlias(m, 'Q3.', 'T'), 'id3');
});

test('validateTopicLabels keeps numeric ids and rejects an empty answer', () => {
  const r = validateTopicLabels({ labels: [{ q: 1, topic: 2, confidence: 'low' }] });
  assert.ok(r.ok && r.data.labels[0].q === '1' && r.data.labels[0].topic === '2');
  assert.equal(validateTopicLabels({ labels: [] }).ok, false);
});
