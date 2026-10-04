import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ANSWER_CUT_OFF, generateJSON, salvageJSON, extractJSON, finishError, chatCompletionsUrl, parseSSE, googleGenerationConfig } from '../client';
import {
  deriveQuestionType,
  checkNeedsReview,
  validatePageQuestions,
  validateSyllabusStructure,
} from '../validators';
import { pageToQuestionsPrompt, syllabusToStructurePrompt, topicLabelsPrompt } from '../prompts';
import { lastSyllabusPosition, mergeSyllabusSubjects } from '../../logic/syllabus';
import { mergePageParts } from '../../logic/paper';
import { runResumable } from '../resume';
import type { GenerateJSONResult } from '../client';

describe('finishError', () => {
  it('accepts a normal stop', () => {
    assert.strictEqual(finishError('STOP'), null);
    assert.strictEqual(finishError(undefined), null);
  });
  it('reports the output cap and any other early stop', () => {
    assert.strictEqual(finishError('MAX_TOKENS'), ANSWER_CUT_OFF);
    assert.strictEqual(finishError('RECITATION'), 'Model stopped early (RECITATION)');
  });
});

describe('extractJSON around extra text', () => {
  it('ignores an outline before and fix lines after the JSON', () => {
    const raw = 'subjects[0] "DS"\n{"a": 1}\nfix: subjects[0].name = "X"';
    assert.strictEqual(extractJSON(raw), '{"a": 1}');
  });

  it('picks the full object over a smaller draft or snippet', () => {
    const raw = '{"a": 1}\nfinal:\n{"a": 1, "b": [2, 3]}\n{"c": 1}';
    assert.strictEqual(extractJSON(raw), '{"a": 1, "b": [2, 3]}');
  });

  it('does not count braces inside strings', () => {
    assert.strictEqual(extractJSON('ok {"t": "a } b { c"} done'), '{"t": "a } b { c"}');
  });

  it('falls back to first/last brace when nothing parses', () => {
    assert.strictEqual(extractJSON('{"a": '), null);
    assert.strictEqual(extractJSON('{"a": 1,}'), '{"a": 1,}');
  });
});

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

describe('prompt wording', () => {
  it('every prompt has tie-breaker rules and never asks for "no planning" or a thinking format', () => {
    const all = [
      pageToQuestionsPrompt(1, 1),
      syllabusToStructurePrompt(),
      topicLabelsPrompt('T1 | U | t', 'Q1 | q'),
    ];
    for (const p of all) {
      assert.ok(p.includes('When unsure'));
      assert.ok(!p.includes('no planning'));
      assert.ok(!p.includes('How to think'));
    }
  });

  it('names stay exact in every details mode', () => {
    for (const mode of ['exact', 'summary', 'none'] as const) {
      assert.ok(syllabusToStructurePrompt(null, mode).includes('NAMES EXACTLY as printed'));
    }
  });

  it('details mode swaps only the details rule', () => {
    const exact = syllabusToStructurePrompt();
    const summary = syllabusToStructurePrompt(null, 'summary');
    const none = syllabusToStructurePrompt(null, 'none');
    assert.ok(exact.includes('in your own words') && exact.includes('word for word'));
    assert.ok(summary.includes('in your own words') && !summary.includes('No length limit'));
    assert.ok(none.includes('leave details out') && !none.includes('in your own words'));
    assert.ok(none.includes('Names (subject, unit, topic) are still copied exactly'));
    assert.ok(exact.includes('MUST be reworded') && summary.includes('MUST be reworded'));
    assert.ok(!none.includes('REWORD') && !none.includes('reworded')); // no contradiction when details are left out
  });

  it('syllabus example shows several subjects', () => {
    const p = syllabusToStructurePrompt();
    assert.ok(p.includes('"Engineering Physics"') && p.includes('"Data Structures Lab"'));
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

  it('says a document can hold several subjects, and only names a previous subject when given one', () => {
    const base = syllabusToStructurePrompt();
    assert.ok(base.includes('several subjects'));
    assert.ok(!base.includes('continue a syllabus'));

    const next = syllabusToStructurePrompt({ subject: 'Operating Systems', code: 'CS401', unit: 'Unit 3: Memory' });
    assert.ok(next.includes('continue a syllabus'));
    assert.ok(next.includes('"Operating Systems" (code CS401)'));
    assert.ok(next.includes('unit "Unit 3: Memory"'));
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

  it('joins a subject that continues in the next chunk, appending split topic details', () => {
    const chunk1 = [
      { name: 'Networks', code: 'CS502', units: [{ name: 'Unit 2', topics: [{ name: 'Routing', details: 'Distance vector,' }] }] },
    ];
    const chunk2 = [
      { name: 'Networks', code: 'CS502', units: [{ name: 'Unit 2', topics: [{ name: 'Routing', details: 'link state.' }, { name: 'TCP' }] }] },
      { name: 'Compilers', code: 'CS503', units: [] },
    ];
    const merged = mergeSyllabusSubjects([chunk1, chunk2]);
    assert.strictEqual(merged.length, 2);
    assert.strictEqual(merged[0].units.length, 1);
    assert.strictEqual(merged[0].units[0].topics.length, 2);
    assert.strictEqual(merged[0].units[0].topics[0].details, 'Distance vector, link state.');
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



describe('lastSyllabusPosition', () => {
  it('returns the last subject and its last unit', () => {
    const pos = lastSyllabusPosition([
      { name: 'A', code: null, units: [{ name: 'U1', topics: [] }] },
      { name: 'B', code: 'B1', units: [{ name: 'U1', topics: [] }, { name: 'U2', topics: [{ name: 'T1' }, { name: 'T2' }] }] },
    ]);
    assert.deepStrictEqual(pos, { subject: 'B', code: 'B1', unit: 'U2', topic: 'T2' });
  });

  it('handles a subject with no units and an empty list', () => {
    assert.deepStrictEqual(lastSyllabusPosition([{ name: 'A', code: null, units: [] }]), { subject: 'A', code: null, unit: null, topic: null });
    assert.strictEqual(lastSyllabusPosition([]), null);
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

describe('parseSSE', () => {
  it('parses complete data lines and keeps a split line for the next chunk', () => {
    const a = parseSSE('data: {"a":1}\n\ndata: {"b":');
    assert.deepStrictEqual(a.events, [{ a: 1 }]);
    assert.strictEqual(a.rest, 'data: {"b":');
    const b = parseSSE(a.rest + '2}\n\n');
    assert.deepStrictEqual(b.events, [{ b: 2 }]);
    assert.strictEqual(b.rest, '');
  });

  it('skips non-data lines and bad JSON', () => {
    const r = parseSSE(': keep-alive\ndata: not json\ndata: {"ok":true}\n');
    assert.deepStrictEqual(r.events, [{ ok: true }]);
  });
});

describe('googleGenerationConfig', () => {
  it('asks Gemma to skip thinking only when thinking is off', () => {
    assert.deepStrictEqual(googleGenerationConfig(0, true, false).thinkingConfig, { thinkingLevel: 'minimal' });
    assert.strictEqual(googleGenerationConfig(0, true, true).thinkingConfig, undefined);
    assert.strictEqual(googleGenerationConfig(1, false, true).responseMimeType, undefined);
  });
});

describe('generateJSON stop', () => {
  it('returns a fatal "Stopped." result without calling the network when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const res = await generateJSON({
      prompt: 'x', schemaName: 'pageQuestions', provider: 'aistudio', apiKey: 'k', modelId: 'm', signal: controller.signal,
    });
    assert.ok(!res.ok && res.fatal && res.friendlyError === 'Stopped.');
  });
});

describe('salvageJSON', () => {
  it('keeps every complete item and closes what is still open', () => {
    const cut = '{"subjects":[{"name":"A","units":[{"name":"U","topics":[{"name":"T1"},{"name":"T2"},{"name":"T3","det';
    const out = salvageJSON(cut)!;
    assert.deepStrictEqual(JSON.parse(out).subjects[0].units[0].topics.map((t: any) => t.name), ['T1', 'T2']);
  });

  it('ignores braces and quotes inside strings', () => {
    const out = salvageJSON('{"a":[{"x":"1"},{"x":"say \\"hi\\" }"},{"x":"3');
    assert.deepStrictEqual(JSON.parse(out!).a.map((o: any) => o.x), ['1', 'say "hi" }']);
  });

  it('returns null when no object was completed', () => {
    assert.strictEqual(salvageJSON('{"labels":[{"q":"Q1","top'), null);
    assert.strictEqual(salvageJSON('no json here'), null);
  });

  it('leaves a complete answer unchanged', () => {
    assert.strictEqual(salvageJSON('{"a":[1,{"b":2}]}'), '{"a":[1,{"b":2}]}');
  });
});

describe('runResumable', () => {
  type D = { items: string[] };
  const merge = (ps: D[]): D => ({ items: ps.flatMap((p) => p.items) });
  const size = (d: D) => d.items.length;
  const ok = (items: string[]): GenerateJSONResult<D> => ({ ok: true, data: { items }, rawText: '', timeMs: 0 });
  const stopped = (partial?: D): GenerateJSONResult<D> => ({
    ok: false, error: 'stopped', friendlyError: 'stopped', fatal: false, partial, timeMs: 0,
  });

  it('keeps the partial and asks for the rest, then merges', async () => {
    const seen: (D | null)[] = [];
    const answers = [stopped({ items: ['a', 'b'] }), ok(['c'])];
    const { res, parts } = await runResumable<D>({ call: async (soFar) => (seen.push(soFar), answers.shift()!), merge, size });
    assert.ok(res.ok && res.data.items.join('') === 'abc');
    assert.strictEqual(parts.length, 2);
    assert.deepStrictEqual(seen, [null, { items: ['a', 'b'] }]);
  });

  it('stops when the rest adds nothing new', async () => {
    const answers = [stopped({ items: ['a'] }), stopped({ items: [] }), ok(['never'])];
    const { res, parts } = await runResumable<D>({ call: async () => answers.shift()!, merge, size });
    assert.ok(!res.ok);
    assert.deepStrictEqual(merge(parts).items, ['a']);
  });

  it('gives up at once when there is no partial (or the user stopped)', async () => {
    let calls = 0;
    const { res, parts } = await runResumable<D>({ call: async () => (calls++, stopped()), merge, size });
    assert.ok(!res.ok);
    assert.strictEqual(calls, 1);
    assert.strictEqual(parts.length, 0);
  });

  it('never calls more than maxCalls times', async () => {
    let n = 0;
    await runResumable<D>({ call: async () => stopped({ items: [`x${n++}`] }), merge, size, maxCalls: 3 });
    assert.strictEqual(n, 3);
  });
});

describe('resume prompts and page merge', () => {
  it('syllabus prompt names where the earlier answer stopped', () => {
    const p = syllabusToStructurePrompt(null, 'exact', { subject: 'Maths', code: null, unit: 'Unit 2', topic: 'Limits' });
    assert.ok(p.includes('topic "Limits"') && p.includes('unit "Unit 2"') && p.includes('subject "Maths"'));
    assert.ok(!syllabusToStructurePrompt(null, 'exact').includes('stopped midway'));
  });

  it('page prompt names the last question kept', () => {
    assert.ok(pageToQuestionsPrompt(1, 2, undefined, '3b: Define a stack').includes('3b: Define a stack'));
    assert.ok(!pageToQuestionsPrompt(1, 2).includes('stopped midway'));
  });

  it('mergePageParts keeps the first paper info, drops repeats, resets continues_previous', () => {
    const q = (number: string, text: string, cont = false) => ({
      number, group: null, text, marks: 2, has_options: false, or_alternative: false, continues_previous: cont,
    });
    const meta = { year: 2020, session: null, subject_name: null, subject_code: null };
    const merged = mergePageParts([
      { paper: meta, questions: [q('1', 'a'), q('2', 'b')] },
      { paper: { ...meta, year: null }, questions: [q('2', 'b'), q('3', 'c', true)] },
    ]);
    assert.strictEqual(merged.paper.year, 2020);
    assert.deepStrictEqual(merged.questions.map((x) => x.number), ['1', '2', '3']);
    assert.strictEqual(merged.questions[2].continues_previous, false);
  });
});
