import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractYearFromFilename,
  mergeContinuesPrevious,
  parseLeadingQuestionNumber,
  detectNumberingGaps,
  buildQuestionsFromPages,
} from '../paper';
import { RawExtractedQuestion } from '../../ai/validators';

describe('extractYearFromFilename', () => {
  it('extracts 4-digit years from standard file names', () => {
    assert.strictEqual(extractYearFromFilename('CS201_2023_Summer.pdf'), 2023);
    assert.strictEqual(extractYearFromFilename('Maths_Paper_2019.jpg'), 2019);
    assert.strictEqual(extractYearFromFilename('2024-data-structures.pdf'), 2024);
    assert.strictEqual(extractYearFromFilename('pyq_may_2018_final.pdf'), 2018);
  });

  it('returns null if no valid year exists', () => {
    assert.strictEqual(extractYearFromFilename('syllabus.pdf'), null);
    assert.strictEqual(extractYearFromFilename('img_001.jpg'), null);
    assert.strictEqual(extractYearFromFilename(''), null);
  });

  it('extracts the last prominent year if multiple numbers exist', () => {
    // E.g. CS1980_Exam_2022.pdf -> picks 2022
    assert.strictEqual(extractYearFromFilename('CS1980_Exam_2022.pdf'), 2022);
  });
});

describe('parseLeadingQuestionNumber', () => {
  it('parses direct numbers', () => {
    assert.strictEqual(parseLeadingQuestionNumber('1'), 1);
    assert.strictEqual(parseLeadingQuestionNumber('12'), 12);
  });

  it('parses sub-question numbers', () => {
    assert.strictEqual(parseLeadingQuestionNumber('1a'), 1);
    assert.strictEqual(parseLeadingQuestionNumber('Q2(b)'), 2);
    assert.strictEqual(parseLeadingQuestionNumber('Question 5.a'), 5);
  });

  it('returns null for unparseable input', () => {
    assert.strictEqual(parseLeadingQuestionNumber(''), null);
    assert.strictEqual(parseLeadingQuestionNumber('Bonus'), null);
  });
});

describe('mergeContinuesPrevious', () => {
  it('merges continuation question text into last question of previous page', () => {
    const prev: RawExtractedQuestion[] = [
      {
        number: '1',
        group: 'Part A',
        text: 'Explain QuickSort algorithm and its time',
        marks: 5,
        has_options: false,
        or_alternative: false,
        continues_previous: false,
      },
    ];

    const current: RawExtractedQuestion[] = [
      {
        number: '1 cont.',
        group: null,
        text: 'complexity in the worst case.',
        marks: null,
        has_options: false,
        or_alternative: false,
        continues_previous: true,
      },
      {
        number: '2',
        group: null,
        text: 'Define AVL tree.',
        marks: 2,
        has_options: false,
        or_alternative: false,
        continues_previous: false,
      },
    ];

    const result = mergeContinuesPrevious(prev, current);

    assert.strictEqual(result.prev.length, 1);
    assert.strictEqual(
      result.prev[0].text,
      'Explain QuickSort algorithm and its time complexity in the worst case.',
    );
    assert.strictEqual(result.prev[0].marks, 5);

    // Current page should have continuation question removed
    assert.strictEqual(result.current.length, 1);
    assert.strictEqual(result.current[0].number, '2');
    assert.strictEqual(result.current[0].text, 'Define AVL tree.');
  });

  it('does nothing if current does not continue previous', () => {
    const prev: RawExtractedQuestion[] = [
      {
        number: '1',
        group: null,
        text: 'First question',
        marks: 2,
        has_options: false,
        or_alternative: false,
        continues_previous: false,
      },
    ];

    const current: RawExtractedQuestion[] = [
      {
        number: '2',
        group: null,
        text: 'Second question',
        marks: 2,
        has_options: false,
        or_alternative: false,
        continues_previous: false,
      },
    ];

    const result = mergeContinuesPrevious(prev, current);
    assert.strictEqual(result.prev.length, 1);
    assert.strictEqual(result.current.length, 1);
  });
});

describe('detectNumberingGaps', () => {
  it('detects a jump like 1 -> 3 or 3 -> 5', () => {
    const questions = [
      { number: '1', page: 1 },
      { number: '2', page: 1 },
      { number: '4', page: 2 }, // Gap 2 -> 4
      { number: '5', page: 2 },
    ];

    const gaps = detectNumberingGaps(questions);
    assert.strictEqual(gaps.length, 1);
    assert.strictEqual(gaps[0].afterQuestion, '2');
    assert.strictEqual(gaps[0].beforeQuestion, '4');
    assert.strictEqual(gaps[0].page, 2);
  });

  it('does not flag sub-parts (e.g. 1a, 1b, 2a)', () => {
    const questions = [
      { number: '1a', page: 1 },
      { number: '1b', page: 1 },
      { number: '2a', page: 1 },
      { number: '2b', page: 1 },
    ];

    const gaps = detectNumberingGaps(questions);
    assert.strictEqual(gaps.length, 0);
  });

  it('resets when group changes (e.g. Group A Q1-3, Group B Q1-2)', () => {
    const questions = [
      { number: '1', group: 'Group A', page: 1 },
      { number: '2', group: 'Group A', page: 1 },
      { number: '1', group: 'Group B', page: 1 }, // Group change, not a gap
      { number: '2', group: 'Group B', page: 1 },
    ];

    const gaps = detectNumberingGaps(questions);
    assert.strictEqual(gaps.length, 0);
  });
});

describe('buildQuestionsFromPages', () => {
  it('builds Question domain entities with derived type and needsReview', () => {
    const pages = [
      {
        pageNumber: 1,
        questions: [
          {
            number: '1',
            text: 'What is a binary tree?',
            marks: 2,
            has_options: false,
          },
          {
            number: '2',
            text: 'Choose correct option:',
            marks: 1,
            has_options: true,
          },
          {
            number: '3',
            text: 'Explain Dijkstra in detail with example.',
            marks: null, // null marks -> other + needsReview
          },
        ],
      },
    ];

    const questions = buildQuestionsFromPages(pages, 'paper_123', 2024);

    assert.strictEqual(questions.length, 3);

    // Q1: short, no review
    assert.strictEqual(questions[0].paperId, 'paper_123');
    assert.strictEqual(questions[0].year, 2024);
    assert.strictEqual(questions[0].page, 1);
    assert.strictEqual(questions[0].number, '1');
    assert.strictEqual(questions[0].type, 'short');
    assert.strictEqual(questions[0].needsReview, false);

    // Q2: mcq
    assert.strictEqual(questions[1].type, 'mcq');
    assert.strictEqual(questions[1].needsReview, false);

    // Q3: marks null -> other, needsReview true
    assert.strictEqual(questions[2].type, 'other');
    assert.strictEqual(questions[2].needsReview, true);
  });
});
