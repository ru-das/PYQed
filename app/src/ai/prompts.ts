/**
 * AI prompts. AGENTS.md §8.
 * Keep prompts general (for any university).
 */

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

  return `You are reading ${pageLabel} of a university exam question paper (PYQ). Extract every question and sub-question from this page.
${continuity}
Instructions:
- Transcribe the question text EXACTLY as printed on the page, including formulas (use plain text or simple LaTeX). Do NOT solve, answer, explain, or rephrase anything.
- One entry per answerable part. If a question has sub-parts like (a), (b), (i), (ii), output each part as a separate question entry. Copy any shared lead-in or introductory text (e.g. "Answer the following:", "Given the graph G below:") to the beginning of each sub-part's text.
- Do NOT output a separate entry for the parent question number if its parts are answered separately.
- "marks": Must be a number ONLY if explicitly printed on the page for that question or part, or clearly specified in group instructions (e.g. "Answer any 5: 5 x 2 = 10 marks" -> 2). Otherwise null. NEVER guess marks.
- "has_options": true ONLY if the question is multiple choice and lists choices like (a), (b), (c), (d) or (1), (2), (3), (4).
- "or_alternative": true if the question is an OR alternative of the previous question (e.g. separated by "OR").
- "year": 4-digit number ONLY if the examination year is printed on THIS page; otherwise null.
- Skip generic paper instructions, headers, footers, university names, and page numbers.
- "continues_previous": true if this page starts mid-sentence or mid-question from the previous page.

Output MUST be valid JSON adhering strictly to this schema:
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
 * ≤ 6 pages → one call with all content.
 * > 6 pages → per-page calls, then merge by subject name.
 */
export function syllabusToStructurePrompt(): string {
  return `You are reading a university syllabus document. Extract the academic structure.

Instructions:
- Copy subject names, unit names, and topic names EXACTLY as written in the document.
- Do NOT invent subjects, units, or topics that aren't in the syllabus.
- Skip marks distribution tables, book lists, reference lists, course outcomes (COs/POs), and any non-structural content — UNLESS it's the only structure on the page.
- If a subject has no explicit unit headings, create one unit per heading block or section.
- "details" for each topic = the syllabus text describing that topic (brief summary or keywords if lengthy, otherwise empty string).
- Subject "code" = the course code if printed (e.g. "CS201"), otherwise null.

Output MUST be valid JSON adhering strictly to this schema:
{
  "subjects": [
    {
      "name": "Data Structures",
      "code": "CS201",
      "units": [
        {
          "name": "Unit 1: Arrays and Linked Lists",
          "topics": [
            {
              "name": "Singly Linked List",
              "details": "Creation, insertion, deletion, traversal"
            }
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
  return `You are labelling university exam questions with syllabus topics.

Topics (format: TopicID | UnitName | TopicName):
${topics}

Questions (format: QuestionID | QuestionText):
${questions}

Rules:
- For each question, pick the single best matching topic ID. If no topic fits well, use null.
- "confidence": "high" if the match is clear and unambiguous, "low" if the question could belong to another topic too.
- Use ONLY the topic IDs listed above. Do NOT invent new ones.

Return ONLY this JSON (no extra text):
{"labels":[{"q":"<question id>","topic":"<topic id or null>","confidence":"high or low"}]}`;
}
