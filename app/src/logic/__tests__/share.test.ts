import { describe, it } from 'node:test';
import assert from 'node:assert';
import { toShareFile, parseShareFile, shareFileName } from '../share';
import { Subject } from '../subject';

const subj: Subject = {
  id: 'orig', name: 'Maths', code: 'M1',
  units: [{ id: 'u1', name: 'U1', order: 0, topics: [{ id: 't1', name: 'T1' }] }],
  papers: [],
  questions: [{
    id: 'q1', paperId: 'p', year: 2020, page: 1, number: '1', text: 'What?', marks: 5,
    type: 'long', unitId: 'u1', topicId: 't1', topicConfidence: 'high',
    repeatGroupId: null, needsReview: false, editedByUser: false,
  }],
  practice: { q1: { state: 'got', seen: 2 } }, version: 1,
};

describe('share file', () => {
  it('round-trips without practice, with a new id', () => {
    const file = toShareFile(subj);
    assert.ok(!('practice' in file.subject) && !('id' in file.subject));
    const { subject } = parseShareFile(JSON.parse(JSON.stringify(file)));
    assert.notStrictEqual(subject.id, 'orig');
    assert.deepStrictEqual(subject.practice, {});
    assert.strictEqual(subject.questions[0].topicId, 't1');
  });
  it('rejects non-pyqed or nameless files', () => {
    assert.throws(() => parseShareFile({ foo: 1 }), /valid PYQed/);
    assert.throws(() => parseShareFile(null), /valid PYQed/);
    assert.throws(() => parseShareFile({ app: 'pyqed', subject: { name: ' ' } }), /valid PYQed/);
  });
  it('rejects newer versions', () => {
    assert.throws(() => parseShareFile({ ...toShareFile(subj), version: 99 }), /newer/);
  });
  it('nulls dangling topic refs', () => {
    const f = toShareFile(subj);
    f.subject.questions[0].topicId = 'gone';
    assert.strictEqual(parseShareFile(f).subject.questions[0].topicId, null);
  });
  it('drops image names that could escape the folder', () => {
    const f = toShareFile(subj, { 'p_1.jpg': 'AA', '../evil_1.jpg': 'BB' });
    assert.deepStrictEqual(Object.keys(parseShareFile(f).images), ['p_1.jpg']);
  });
  it('sanitises file names', () => {
    assert.strictEqual(shareFileName('Maths/CS: 1?'), 'MathsCS 1.pyqed.json');
    assert.strictEqual(shareFileName('///'), 'subject.pyqed.json');
  });
});
