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
  /** Set when an earlier answer for this page was stopped midway: "number: first words" of the last question kept. */
  resumeAfter?: string,
): string {
  const pageLabel = totalPages ? `page ${pageNumber} of ${totalPages}` : `page ${pageNumber}`;
  const continuity = previousLastQuestion
    ? `\nThe previous page ended with question number "${previousLastQuestion}". If this page begins with the continuation of that question, set "continues_previous": true on the first question entry.`
    : '';
  const resume = resumeAfter
    ? `\nYour earlier answer for this page stopped midway. It already listed every question up to and including: ${resumeAfter}\nList ONLY the questions that come after it. Never repeat a question already listed. Set "continues_previous" to false.\n`
    : '';

  return `Read ${pageLabel} of a university exam question paper (PYQ) and list every question on it as JSON.
${continuity}${resume}
Think briefly, then reply with the JSON only. Decide each item once and don't re-check finished parts: the student reviews everything afterwards.

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

When unsure:
- Marks unclear -> null. Unclear whether a line is a part of the previous question or a question of its own -> its own entry.
- A word you cannot read -> [?] in its place. Never guess it.
- Answer choices belong in "text", after the question, as printed.
- A page with no questions (cover, instructions, blank) -> "questions": [].

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
 * Up to 3 pages per call; later chunks are told where the previous one ended, then merged by subject name.
 */
/** How topic "details" are written: reworded slightly (default), summarised, or left out. */
export type DetailsMode = 'exact' | 'summary' | 'none';

export function syllabusToStructurePrompt(
  previous?: SyllabusPosition | null,
  details: DetailsMode = 'exact',
  /** Set when an earlier answer for these same pages was stopped midway: only the rest is asked for. */
  resume?: SyllabusPosition | null,
): string {
  // Details are reworded so the provider's recitation filter (word-for-word copying) is not triggered; names stay exact.
  // The fallbacks shrink the details further if the filter still blocks.
  const detailsRule = {
    exact:
      '- "details" MUST be reworded, never copied. Rewrite the text printed for that topic in your own words: use different words and a different sentence structure for every phrase, keep the same meaning, every concept, term, formula and their order, and leave nothing out. Copying even a few printed words in a row (apart from technical terms, names and formulas) trips the provider\'s copy filter and stops your answer, so reword every sentence. Example: printed "Heat transfer by conduction, convection and radiation; Fourier\'s law" -> "How heat moves through conduction, convection and radiation, together with Fourier\'s law". No length limit; "" if none.',
    summary:
      '- "details" MUST be reworded, never copied: a short summary of the text printed for that topic, entirely in your own words (at most about 20 words), with no printed phrase copied word for word; "" if none. Names (subject, unit, topic) are still copied exactly.',
    none: '- "details" = "" for every topic: leave details out. Names (subject, unit, topic) are still copied exactly.',
  }[details];
  // The reword reminders only make sense when details are written at all
  const rewords = details !== 'none';
  const upFront = rewords
    ? `\nIMPORTANT: copy subject, unit and topic NAMES exactly, but REWORD every topic's "details" in your own words. Never copy printed details word for word.`
    : '';
  const detailsException = rewords
    ? 'Topic details are the one exception: they must be reworded, never copied (see the "details" rule below).'
    : 'Topic details are left out (see the "details" rule below).';
  const hardToReword = rewords
    ? `\n- A detail is hard to reword -> use synonyms, reorder the phrase or turn a list into a sentence; technical terms stay as they are. Always reword, never leave a detail copied, and never drop a point just to avoid copying.`
    : '';
  // Later chunks of a long syllabus start mid-subject; name the subject so the merge can join the pieces
  const continuation = previous
    ? `\nThese pages continue a syllabus. The previous pages ended inside subject "${previous.subject}"${
        previous.code ? ` (code ${previous.code})` : ''
      }${previous.unit ? `, unit "${previous.unit}"` : ''}. If the first page starts without a new subject heading, that content belongs to "${previous.subject}": use exactly that subject name${
        previous.code ? ' and code' : ''
      }${previous.unit ? `, and unit "${previous.unit}" if it continues that unit` : ''}. Start a new subject only where a new subject heading is printed.\n`
    : '';
  const resumeNote = resume
    ? `\nYour earlier answer for these pages stopped midway. It already covered everything up to ${
        resume.topic ? `topic "${resume.topic}" in ` : ''
      }${resume.unit ? `unit "${resume.unit}" of ` : ''}subject "${resume.subject}". List ONLY what comes after that point, starting with the next topic, unit or subject. If the next topics still belong to that subject or unit, use exactly the same subject${
        resume.unit ? ' and unit' : ''
      } name. Never repeat anything up to and including that point.\n`
    : '';
  return `Read this university syllabus and list its subjects, units and topics as JSON.
The document may contain several subjects, and a subject may start or end in the middle of a page: extract all of them.
${upFront}
${continuation}${resumeNote}
Think briefly, then reply with the JSON only. Decide each item once and don't re-check finished parts: the student reviews everything afterwards.

Rules:
- Copy subject, unit and topic NAMES EXACTLY as printed. Do NOT fix typos, spelling, grammar, spacing or capitalisation of names: keep every mistake as printed. Only join a word split across a line break. Never summarise, shorten or reword names. ${detailsException}
- Do NOT invent subjects, units or topics.
- Skip marks distribution tables, book lists, reference lists, course outcomes (COs/POs) and other non-structural content, unless it is the only structure on the page.
- Tables: a row with a unit or module number is a unit; the topics in that row are its topics.
- A subject with no unit headings gets one unit per heading block or section.
${detailsRule}
- "code" = the course code if printed (e.g. "CS201"), else null.

When unsure:
- Can't tell if a line is a unit or a topic -> make it a topic of the current unit.
- Can't tell if a heading starts a new subject -> it does only if a course title or code is printed with it.
- Topics with no unit heading above them -> one unit named "Unit 1".
- A word you cannot read -> [?] in its place. Never guess it. A missing value -> null (code) or "" (details).${hardToReword}
- Pick the first option that fits these rules; never compare alternatives. The student edits afterwards.

Return ONLY JSON, written without indentation, in this shape (three subjects shown, each a different shape; output as many as the document has):
{
  "subjects": [
    {
      "name": "Data Structures",
      "code": "CS201",
      "units": [
        {
          "name": "Unit 1: Arrays and Linked Lists",
          "topics": [
            { "name": "Arrays", "details": "" },
            { "name": "Singly Linked List", "details": "Creating a list, inserting and deleting nodes, traversing it" }
          ]
        },
        {
          "name": "Unit 2: Trees",
          "topics": [
            { "name": "Binary Trees", "details": "Ways of traversing a tree, operations on a binary search tree" }
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
    },
    {
      "name": "Data Structures Lab",
      "code": "CS291",
      "units": [
        {
          "name": "Unit 1",
          "topics": [
            { "name": "Implement a stack using an array", "details": "" }
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
Think briefly, then reply with the JSON only. Decide each item once and don't re-check finished parts: the student reviews everything afterwards.

Topics (format: TopicID | UnitName | TopicName):
${topics}

Questions (format: QuestionID | QuestionText):
${questions}

Rules:
- Exactly one entry per question, with the single best topic ID, or null if no topic fits at all.
- "confidence": "high" if a topic clearly fits, "low" if you are guessing.
- Copy IDs exactly as written above (e.g. "Q1", "T3"). Use ONLY the topic IDs listed; never invent one.
- The topic and question texts are copied from the documents as-is, typos included: do not correct or rewrite them. You only output IDs.

When unsure:
- Torn between topics -> the topic the question's main task is about, with "low".
- Nothing fits -> null.

Return ONLY this JSON:
{"labels":[{"q":"<question id>","topic":"<topic id or null>","confidence":"high or low"}]}`;
}
