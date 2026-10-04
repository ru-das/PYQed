/**
 * AI prompts.
 * Keep prompts general (for any university).
 */

import type { SyllabusPosition } from '../logic/syllabus';

/**
 * §8.2 — Paper page → questions prompt.
 * One call per page. Pass the previous page's last question number for continuity.
 */
export function pageToQuestionsPrompt(
  pageNumber: number,
  totalPages?: number,
  previousLastQuestion?: string,
): string {
  const pageLabel = totalPages ? `page ${pageNumber} of ${totalPages}` : `page ${pageNumber}`;
  const continuity = previousLastQuestion
    ? `\nThe previous page ended with question number "${previousLastQuestion}". If this page begins with the continuation of that question, set "continues_previous": true on the first question entry.`
    : '';

  return `Read ${pageLabel} of a university exam question paper (PYQ) and list every question on it as JSON.
Answer directly: start writing the JSON right away, with no planning, drafting or final check. Decide each field once as you read; the student reviews everything afterwards.
${continuity}
Rules:
- Copy each question's text EXACTLY as printed, including formulas (plain text or simple LaTeX). Do NOT solve, answer, explain or rephrase. Do NOT fix typos, spelling, grammar or capitalisation: keep every mistake as printed.
- One entry per answerable part. A question with parts (a), (b), (i), (ii) becomes one entry per part, with any shared lead-in (e.g. "Given the graph G below:") copied exactly at the start of each part's text. No separate entry for a parent whose parts are answered separately.
- "marks": the number printed for that question or part; else the per-question marks given by its group instruction (e.g. "Answer any 5: 5 x 2 = 10" -> 2); else null. Never guess.
- "has_options": true ONLY if answer choices like (a)(b)(c)(d) or (1)(2)(3)(4) are listed.
- "or_alternative": true if it is the OR alternative of the previous question.
- "year": a 4-digit number ONLY if the exam year is printed on THIS page, else null.
- "continues_previous": true if the page starts mid-sentence or mid-question.
- Skip generic instructions, headers, footers, university names and page numbers.
- If extracted text is also given, the image is the source of truth; use the text only to help read hard characters.

Return ONLY JSON in this shape:
{
  "paper": {
    "year": 2023,
    "session": "Winter or null",
    "subject_name": "Data Structures or null",
    "subject_code": "CS201 or null"
  },
  "questions": [
    {
      "number": "1a",
      "group": "Group A or null",
      "text": "Define an AVL tree and state its balance factor property.",
      "marks": 3,
      "has_options": false,
      "or_alternative": false,
      "continues_previous": false
    }
  ]
}`;
}

/**
 * §8.1 — Syllabus → structure prompt.
 * Input: syllabus page text or images.
 * Up to 6 pages per call; later chunks are told where the previous one ended, then merged by subject name.
 */
export function syllabusToStructurePrompt(previous?: SyllabusPosition | null): string {
  // Later chunks of a long syllabus start mid-subject; name the subject so the merge can join the pieces
  const continuation = previous
    ? `\nThese pages continue a syllabus. The previous pages ended inside subject "${previous.subject}"${
        previous.code ? ` (code ${previous.code})` : ''
      }${previous.unit ? `, unit "${previous.unit}"` : ''}. If the first page starts without a new subject heading, that content belongs to "${previous.subject}": use exactly that subject name${
        previous.code ? ' and code' : ''
      }${previous.unit ? `, and unit "${previous.unit}" if it continues that unit` : ''}. Start a new subject only where a new subject heading is printed.\n`
    : '';
  return `Read this university syllabus and list its subjects, units and topics as JSON.
Answer directly: start writing the JSON right away, with no planning, drafting or final check. Decide each item once as you read; the student reviews and edits everything afterwards.
The document may contain several subjects, and a subject may start or end in the middle of a page: extract all of them.
${continuation}
Rules:
- Copy subject, unit and topic names and topic details EXACTLY as printed. Do NOT fix typos, spelling, grammar, spacing or capitalisation: keep every mistake as printed. Only join a word split across a line break. Never summarise, shorten or reword.
- Do NOT invent subjects, units or topics.
- Skip marks distribution tables, book lists, reference lists, course outcomes (COs/POs) and other non-structural content, unless it is the only structure on the page.
- Tables: a row with a unit or module number is a unit; the topics in that row are its topics.
- A subject with no unit headings gets one unit per heading block or section.
- "details" = the text printed for that topic, copied exactly with no length limit; "" if none.
- "code" = the course code if printed (e.g. "CS201"), else null.

Return ONLY JSON in this shape (two subjects shown; output as many as the document has):
{
  "subjects": [
    {
      "name": "Data Structures",
      "code": "CS201",
      "units": [
        {
          "name": "Unit 1: Arrays and Linked Lists",
          "topics": [
            { "name": "Singly Linked List", "details": "Creation, insertion, deletion, traversal" }
          ]
        }
      ]
    },
    {
      "name": "Engineering Physics",
      "code": null,
      "units": [
        {
          "name": "Module 1: Waves",
          "topics": [
            { "name": "Interference", "details": "" }
          ]
        }
      ]
    }
  ]
}`;
}

/**
 * §8.3 — Questions → topic labels prompt.
 * Input: subject topics as compact list + questions as Q-id | text.
 * Output: labels with topic IDs and confidence.
 */
export function topicLabelsPrompt(topics: string, questions: string): string {
  return `Label each university exam question with the one syllabus topic it belongs to.
Answer directly: start writing the JSON right away, with no planning or final check. Decide each question once; the student can move questions later.

Topics (format: TopicID | UnitName | TopicName):
${topics}

Questions (format: QuestionID | QuestionText):
${questions}

Rules:
- Exactly one entry per question, with the single best topic ID, or null if no topic fits at all.
- "confidence": "high" if a topic clearly fits, "low" if you are guessing.
- Copy IDs exactly as written above (e.g. "Q1", "T3"). Use ONLY the topic IDs listed; never invent one.
- The topic and question texts are copied from the documents as-is, typos included: do not correct or rewrite them. You only output IDs.

Return ONLY this JSON:
{"labels":[{"q":"<question id>","topic":"<topic id or null>","confidence":"high or low"}]}`;
}

/**
 * Repeat groups prompt.
 * Input: questions of one or more topics, listed under "Topic: name" headings as "QuestionID | year | text".
 * Output: groups of question IDs that ask essentially the same thing.
 */
export function repeatGroupsPrompt(questions: string): string {
  return `Find repeated questions in university exam papers. The questions are listed under their syllabus topic.
Answer directly: start writing the JSON right away, with no planning or final check. Decide each pair once.

Questions (format: QuestionID | Year | QuestionText):
${questions}

Rules:
- Group questions that ask for the same task, even if worded differently or with different values. Example: "Find the shortest path in graph A" and "Use Dijkstra on graph B" are the same task.
- Do NOT group questions that only share a topic but ask for different tasks. Example: "Define a stack" and "Convert infix to postfix using a stack" are different.
- Only group questions under the same topic heading; never mix topics in one group.
- Each ID in at most one group; every group has at least 2 IDs. Leave out questions with no repeat. Use ONLY the IDs listed.
- Do not correct or rewrite the question texts. You only output IDs.

Return ONLY this JSON:
{"groups":[["<id>","<id>"],["<id>","<id>","<id>"]]}`;
}
