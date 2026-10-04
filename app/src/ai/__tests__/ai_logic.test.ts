import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractJSON, chatCompletionsUrl } from '../client';
import {
  validateRepeatGroups,
  deriveQuestionType,
  checkNeedsReview,
  validatePageQuestions,
  validateSyllabusStructure,
} from '../validators';
import { pageToQuestionsPrompt, syllabusToStructurePrompt } from '../prompts';
import { mergeSyllabusSubjects } from '../../logic/syllabus';

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

describe('syllabusToStructurePrompt', () => {
  it('contains essential instructions for syllabus extraction', () => {
    const prompt = syllabusToStructurePrompt();
    assert.ok(prompt.includes('university syllabus'));
    assert.ok(prompt.includes('subjects'));
    assert.ok(prompt.includes('units'));
    assert.ok(prompt.includes('topics'));
    assert.ok(prompt.includes('Skip marks distribution tables'));
  });
});

describe('validateSyllabusStructure', () => {
  it('validates a correct syllabus structure response', () => {
    const payload = {
      subjects: [
        {
          name: 'Data Structures',
          code: 'CS201',
          units: [
            {
              name: 'Unit 1: Arrays',
              topics: [
                {
                  name: 'Linear Arrays',
                  details: 'Traversal, Insertion, Deletion',
                },
              ],
            },
          ],
        },
      ],
    };

    const res = validateSyllabusStructure(payload);
    assert.strictEqual(res.ok, true);
    if (res.ok) {
      assert.strictEqual(res.data.subjects.length, 1);
      assert.strictEqual(res.data.subjects[0].name, 'Data Structures');
      assert.strictEqual(res.data.subjects[0].code, 'CS201');
      assert.strictEqual(res.data.subjects[0].units.length, 1);
      assert.strictEqual(res.data.subjects[0].units[0].topics[0].name, 'Linear Arrays');
      assert.strictEqual(res.data.subjects[0].units[0].topics[0].details, 'Traversal, Insertion, Deletion');
    }
  });

  it('rejects payload missing subjects array', () => {
    const res = validateSyllabusStructure({ items: [] });
    assert.strictEqual(res.ok, false);
  });

  it('rejects empty subjects array', () => {
    const res = validateSyllabusStructure({ subjects: [] });
    assert.strictEqual(res.ok, false);
  });

  it('rejects subject without a name', () => {
    const res = validateSyllabusStructure({ subjects: [{ name: '  ', units: [] }] });
    assert.strictEqual(res.ok, false);
  });

  it('skips empty unit names and empty topic names gracefully', () => {
    const payload = {
      subjects: [
        {
          name: 'Algorithms',
          code: null,
          units: [
            { name: '   ', topics: [] },
            {
              name: 'Unit 1',
              topics: [
                { name: '   ', details: 'Empty' },
                { name: 'Sorting', details: 'Merge sort' },
              ],
            },
          ],
        },
      ],
    };
    const res = validateSyllabusStructure(payload);
    assert.strictEqual(res.ok, true);
    if (res.ok) {
      assert.strictEqual(res.data.subjects[0].units.length, 1);
      assert.strictEqual(res.data.subjects[0].units[0].name, 'Unit 1');
      assert.strictEqual(res.data.subjects[0].units[0].topics.length, 1);
      assert.strictEqual(res.data.subjects[0].units[0].topics[0].name, 'Sorting');
    }
  });

  it('rejects if more than 30 subjects', () => {
    const subjects = Array.from({ length: 31 }, (_, i) => ({
      name: `Subject ${i}`,
      units: [],
    }));
    const res = validateSyllabusStructure({ subjects });
    assert.strictEqual(res.ok, false);
    if (!res.ok) {
      assert.ok(res.error.includes('Too many subjects'));
    }
  });
});

describe('mergeSyllabusSubjects', () => {
  it('merges subjects with the same name across pages', () => {
    const page1 = [
      {
        name: 'Database Management',
        code: 'CS301',
        units: [
          {
            name: 'Unit 1: ER Model',
            topics: [{ name: 'ER Diagrams', details: 'Entity, Attributes' }],
          },
        ],
      },
    ];

    const page2 = [
      {
        name: 'database management', // case-insensitive match
        code: null,
        units: [
          {
            name: 'Unit 2: Relational Model',
            topics: [{ name: 'Relational Algebra', details: 'Select, Project' }],
          },
        ],
      },
    ];

    const merged = mergeSyllabusSubjects([page1, page2]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].name, 'Database Management');
    assert.strictEqual(merged[0].code, 'CS301');
    assert.strictEqual(merged[0].units.length, 2);
    assert.strictEqual(merged[0].units[0].name, 'Unit 1: ER Model');
    assert.strictEqual(merged[0].units[1].name, 'Unit 2: Relational Model');
  });

  it('combines topics in units with the same name and avoids duplicates', () => {
    const batch1 = [
      {
        name: 'OS',
        code: 'CS401',
        units: [
          {
            name: 'Processes',
            topics: [
              { name: 'Threads', details: 'User vs kernel' },
              { name: 'Process Scheduling' },
            ],
          },
        ],
      },
    ];

    const batch2 = [
      {
        name: 'OS',
        code: null,
        units: [
          {
            name: 'processes',
            topics: [
              { name: 'threads', details: 'User vs kernel threads detail' }, // duplicate name, details should update if richer
              { name: 'Deadlocks', details: 'Banker algorithm' },
            ],
          },
        ],
      },
    ];

    const merged = mergeSyllabusSubjects([batch1, batch2]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].units.length, 1);
    assert.strictEqual(merged[0].units[0].topics.length, 3);
    assert.strictEqual(merged[0].units[0].topics[0].name, 'Threads');
    assert.strictEqual(merged[0].units[0].topics[1].name, 'Process Scheduling');
    assert.strictEqual(merged[0].units[0].topics[2].name, 'Deadlocks');
  });

  it('keeps distinct subjects separate', () => {
    const batch1 = [{ name: 'Compiler Design', code: 'CS501', units: [] }];
    const batch2 = [{ name: 'Computer Networks', code: 'CS502', units: [] }];

    const merged = mergeSyllabusSubjects([batch1, batch2]);
    assert.strictEqual(merged.length, 2);
    assert.strictEqual(merged[0].name, 'Compiler Design');
    assert.strictEqual(merged[1].name, 'Computer Networks');
  });
});



describe('validateRepeatGroups (§8.4)', () => {
  it('drops unknown ids, reused ids and groups smaller than 2', () => {
    const valid = new Set(['a', 'b', 'c', 'd']);
    const res = validateRepeatGroups(
      { groups: [['a', 'b', 'zzz'], ['b', 'c'], ['c', 'd'], ['d']] },
      valid,
    );
    assert.ok(res.ok);
    // ['b','c'] -> only 'c' left (b reused) -> dropped; ['c','d'] kept
    assert.deepStrictEqual(res.data.groups, [['a', 'b'], ['c', 'd']]);
  });

  it('rejects a response without a groups array', () => {
    assert.strictEqual(validateRepeatGroups({}).ok, false);
  });
});

describe('repeat batching', () => {
  it('packs small topics together without splitting a topic', async () => {
    const { packBatches } = await import('../groupRepeats');
    const topic = (n: number) => Array.from({ length: n }, (_, i) => i);
    const batches = packBatches([topic(30), topic(25), topic(20), topic(70)], 60);
    assert.deepStrictEqual(batches.map((b) => b.map((t) => t.length)), [[30, 25], [20], [70]]);
  });

  it('keeps only groups that stay within one topic', async () => {
    const { groupsByTopic } = await import('../groupRepeats');
    const topicOf = new Map([['Q1', 'a'], ['Q2', 'a'], ['Q3', 'b'], ['Q4', 'b']]);
    const out = groupsByTopic([['Q1', 'Q2'], ['Q2', 'Q3'], ['Q3', 'Q4']], topicOf);
    assert.deepStrictEqual(out.get('a'), [['Q1', 'Q2']]);
    assert.deepStrictEqual(out.get('b'), [['Q3', 'Q4']]);
  });
});

describe('chatCompletionsUrl', () => {
  it('appends /chat/completions and tolerates trailing slashes', () => {
    assert.strictEqual(chatCompletionsUrl('https://x/v1'), 'https://x/v1/chat/completions');
    assert.strictEqual(chatCompletionsUrl('https://x/v1/'), 'https://x/v1/chat/completions');
  });
  it('keeps a URL that already ends in /chat/completions', () => {
    assert.strictEqual(
      chatCompletionsUrl(' https://x/v1/chat/completions '),
      'https://x/v1/chat/completions',
    );
  });
});
