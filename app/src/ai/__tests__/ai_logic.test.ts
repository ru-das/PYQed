import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractJSON } from '../client';
import {
  deriveQuestionType,
  checkNeedsReview,
  validatePageQuestions,
} from '../validators';
import { pageToQuestionsPrompt } from '../prompts';

describe('extractJSON', () => {
  it('extracts plain JSON object', () => {
    const raw = '{"hello": "world"}';
    assert.strictEqual(extractJSON(raw), '{"hello": "world"}');
  });

  it('extracts JSON surrounded by markdown code blocks', () => {
    const raw = 'Here is the result:\n```json\n{"paper": {"year": 2023}}\n```\nHope that helps!';
    assert.strictEqual(extractJSON(raw), '{"paper": {"year": 2023}}');
  });

  it('strips <think> thinking tags before extracting JSON', () => {
    const raw = '<think>Let me analyze the paper first. The questions are on page 1.</think>{"paper": null, "questions": []}';
    assert.strictEqual(extractJSON(raw), '{"paper": null, "questions": []}');
  });

  it('strips ```thinking blocks before extracting JSON', () => {
    const raw = '```thinking\nAnalyzing structure...\n```\n{"paper": null, "questions": []}';
    assert.strictEqual(extractJSON(raw), '{"paper": null, "questions": []}');
  });

  it('returns null if no JSON object is present', () => {
    assert.strictEqual(extractJSON('No json here'), null);
    assert.strictEqual(extractJSON(''), null);
  });
});

describe('deriveQuestionType (AGENTS.md §8.2)', () => {
  it('returns mcq if hasOptions is true regardless of marks', () => {
    assert.strictEqual(deriveQuestionType(1, true), 'mcq');
    assert.strictEqual(deriveQuestionType(5, true), 'mcq');
    assert.strictEqual(deriveQuestionType(null, true), 'mcq');
  });

  it('returns other if marks is null', () => {
    assert.strictEqual(deriveQuestionType(null, false), 'other');
  });

  it('returns short if marks <= 3', () => {
    assert.strictEqual(deriveQuestionType(1, false), 'short');
    assert.strictEqual(deriveQuestionType(2, false), 'short');
    assert.strictEqual(deriveQuestionType(3, false), 'short');
  });

  it('returns long if marks > 3', () => {
    assert.strictEqual(deriveQuestionType(4, false), 'long');
    assert.strictEqual(deriveQuestionType(5, false), 'long');
    assert.strictEqual(deriveQuestionType(10, false), 'long');
  });
});

describe('checkNeedsReview (AGENTS.md §8.2)', () => {
  it('flags null marks for review', () => {
    assert.strictEqual(checkNeedsReview('What is Dijkstra algorithm?', null), true);
  });

  it('flags suspiciously short text (<10 chars) for review', () => {
    assert.strictEqual(checkNeedsReview('What is?', 5), true);
    assert.strictEqual(checkNeedsReview('Short', 2), true);
  });

  it('passes normal questions with marks', () => {
    assert.strictEqual(
      checkNeedsReview('Explain Dijkstra algorithm and its complexity.', 5),
      false,
    );
  });
});

describe('validatePageQuestions', () => {
  it('validates a complete valid paper response', () => {
    const payload = {
      paper: {
        year: 2024,
        session: 'Summer',
        subject_name: 'Operating Systems',
        subject_code: 'CS401',
      },
      questions: [
        {
          number: '1a',
          group: 'Section A',
          text: 'Explain process state transition diagram with neat sketch.',
          marks: 5,
          has_options: false,
          or_alternative: false,
          continues_previous: false,
        },
      ],
    };

    const res = validatePageQuestions(payload);
    assert.strictEqual(res.ok, true);
    if (res.ok) {
      assert.strictEqual(res.data.paper.year, 2024);
      assert.strictEqual(res.data.paper.subject_name, 'Operating Systems');
      assert.strictEqual(res.data.questions.length, 1);
      assert.strictEqual(res.data.questions[0].marks, 5);
      assert.strictEqual(res.data.questions[0].number, '1a');
    }
  });

  it('rejects payload missing questions array', () => {
    const res = validatePageQuestions({ paper: null });
    assert.strictEqual(res.ok, false);
  });

  it('rejects questions with empty text', () => {
    const payload = {
      paper: null,
      questions: [{ number: '1', text: '   ', marks: 2 }],
    };
    const res = validatePageQuestions(payload);
    assert.strictEqual(res.ok, false);
  });
});

describe('pageToQuestionsPrompt', () => {
  it('generates prompt with continuity when previousLastQuestion is supplied', () => {
    const prompt = pageToQuestionsPrompt(2, 5, '3b');
    assert.ok(prompt.includes('page 2 of 5'));
    assert.ok(prompt.includes('3b'));
    assert.ok(prompt.includes('continues_previous'));
  });

  it('generates prompt without continuity on page 1', () => {
    const prompt = pageToQuestionsPrompt(1, 1);
    assert.ok(prompt.includes('page 1 of 1'));
    assert.ok(!prompt.includes('The previous page ended with'));
  });
});
