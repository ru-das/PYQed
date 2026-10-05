# PYQed

Turn your university syllabus and past year question papers (PYQs) into a topic-wise question bank you can sort, filter and practise.

**Powered by [Gemma 4](https://ai.google.dev/gemma), an open-weight model from Google DeepMind.**

Built for the DEV.to Hacktoberfest Weekend Challenge 2026, theme "Build for a Friend". Built on a 4 GB RAM laptop with no GPU, no server and no budget.

## Download

Get the Android APK from the [latest GitHub Release](https://github.com/ru-das/PYQed/releases/latest). On iPhone, run it through Expo Go (see [Setup](#setup-for-development)).

## Screenshots

| Home | Syllabus review | Paper review |
|---|---|---|
| _Screenshot coming_ | _Screenshot coming_ | _Screenshot coming_ |

| Topic view | All questions | Practice |
|---|---|---|
| _Screenshot coming_ | _Screenshot coming_ | _Screenshot coming_ |

## The problem

Before exams, students skim years of PYQs trying to guess what matters, or trust unverified "suggestions" from seniors. PYQed answers it with data: which units carry the most marks, and which questions keep coming back.

It works for any university's syllabus and paper format. Nothing is hard-coded to one university.

## What it does

1. Create subjects by hand, or import a syllabus and PYQed creates them (each subject has units and topics).
2. Add PYQ papers as PDFs or photos. Most PYQ PDFs are scanned images, and that is fine.
3. Gemma 4 reads every page, extracts the questions with number, marks and group, and labels each question with a syllabus topic.
4. Code does all the counting: marks per unit, how often a question repeated, priority, sorting.
5. Each topic lists its questions by marks, then by times asked. An **All questions** view does the same across the subject, with sorting and filters.
6. **Practice mode** shows questions from the topics you pick as random flashcards (Got it / Revise).
7. Export a subject as one `.pyqed.json` file and share it (for example on WhatsApp). The receiver opens it with no API key.

## Design principle

**AI reads and labels, code counts, you have the final say.**

- Gemma 4 only transcribes and labels, and returns JSON. Every JSON answer is validated.
- No number in the app comes from the AI. Totals, frequencies, priorities, question types and sorting are plain code.
- You review every imported paper next to the original page image, and you can edit anything. Your edits are never overwritten.
- Nothing fails silently. Unreadable marks show as "? marks" and are flagged, never guessed. An invalid topic puts the question in **Unassigned**. Gaps in question numbers show a warning. A page that can't be read gets Retry and "Add questions manually".

## Architecture

Everything runs on the phone. There is no backend.

```
Expo app (React Native, TypeScript, Expo Router)
────────────────────────────────────────────────
Pick files: PDF (expo-document-picker) / photos (expo-image-picker)
        │
        ▼
Hidden WebView "PDF worker" (pdf.js 3.11, bundled, works offline)
   page has a text layer? → page text
   scanned page?          → JPEG, long edge ~1600 px
        │
        ▼
AI client (user's own key, kept in expo-secure-store)
   Google AI Studio (default) / OpenRouter / any OpenAI-compatible endpoint
   Gemma 4:  syllabus → structure | page → questions | questions → topic labels
        │
        ▼
Validation + code: counting, ranking, repeats, question type, practice weighting
        │
        ▼
Local storage (expo-file-system): one JSON file per subject + page images
Share: export / open  .pyqed.json  (expo-sharing / expo-document-picker)
```

Notes on how the AI calls behave:

- **Streaming.** Gemma 4 thinks before it answers, and a table-heavy syllabus page can take minutes. Responses are streamed, and a call is cut off only after 90 s of silence (or 12 min in total).
- **Stopped answers are kept.** If the provider ends an answer midway, the complete part is kept and only the rest is asked for.
- **Resume.** On a rate limit (429), imports stop with your progress saved and resume from the last finished page.
- **Repeats are code-only.** Questions with the same wording in at least two different years are grouped. No AI call is used for this.

Repo layout:

```
app/
  app/            screens (Expo Router)
  src/ai/         AI client, prompts, validators, import jobs
  src/pdf/        PDF worker WebView + bridge
  src/store/      subject storage
  src/logic/      ranking, practice, merging, sharing (pure functions + tests)
  src/components/ shared UI (ui.tsx, QuestionCard, ...)
AGENTS.md         project context and spec for coding agents
SPEC.md           requirements and acceptance criteria
```

## Get a free API key

PYQed is usable without a key (manual subjects, opening shared subjects, practice). You need one only to import a syllabus or paper.

**Google AI Studio (default, free):**

1. Open <https://aistudio.google.com/apikey> and sign in with a Google account.
2. Click **Create API key** and copy it.
3. In PYQed, paste it in the key sheet that appears on import (or in **Settings**) and tap **Test key**.

Default model: `gemma-4-26b-a4b-it` (faster). Switch to `gemma-4-31b-it` (larger) in Settings. Free-tier limits apply; PYQed makes calls one at a time and resumes after a limit.

**Other providers (optional, chosen in Settings):**

- **OpenRouter:** key from <https://openrouter.ai/keys>, default model `google/gemma-4-26b-a4b-it:free`.
- **OpenAI-compatible:** enter a base URL, key (optional for local servers) and model ID, for example LM Studio or vLLM. The model must accept images.

**Privacy:** your key stays on your phone in secure storage and is never included in exported files. Pages are sent to the provider you chose only while importing. Everything else stays on the phone.

## Setup for development

You need Node.js (LTS), a phone with [Expo Go](https://expo.dev/go), and nothing else: no Android Studio or emulator.

```bash
cd app
npm install
npx expo start --tunnel
```

Scan the QR code with Expo Go. If Expo opens a development-build prompt instead, press `s` in the terminal to switch to Expo Go.

Other commands (run inside `app/`):

```bash
npm test                    # unit tests for the pure logic (Node test runner via tsx)
npm run generate-pdf-html   # regenerate the inlined pdf.js worker page
eas build -p android --profile preview   # cloud APK build with EAS
```

## How to contribute

Contributions are welcome, from bug reports to pull requests.

- **Report a bug or suggest something:** open an issue. For an import problem, say which provider and model you used, and describe the page (a scanned PDF, a photo, a table-heavy syllabus). Never paste your API key.
- **Send a pull request:**
  1. Fork the repo and create a branch from `main`.
  2. Make a small, focused change. Match the style of the code around it, and reuse the shared pieces in `app/src/components/ui.tsx` instead of adding per-screen styles.
  3. Run `npm test` in `app/` and add a test if you change anything in `src/logic` or `src/ai/validators.ts`.
  4. Open a PR that says what changed and why. Include a screenshot for UI changes.
- **Ground rules** (the full reasoning is in [AGENTS.md](AGENTS.md)):
  - Keep it Expo Go compatible: Expo SDK modules and pure-JS libraries only. Ask first before adding a dependency.
  - No backend, and no hard-coded rules that only fit one university or paper format.
  - The AI reads and labels; code does all counting.
  - Don't commit API keys.
- **Good first areas:** more unit tests, accessibility labels, translations, and testing with syllabi and papers from other universities.

## Credits

**Open model**

- [Gemma 4](https://ai.google.dev/gemma) by Google DeepMind (open weights). It does all the reading and labelling. Use is subject to the [Gemma terms](https://ai.google.dev/gemma/terms).

**Libraries**

| Library | Used for | License |
|---|---|---|
| [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist` 3.11) by Mozilla | Reading PDFs inside the WebView | Apache-2.0 |
| [Expo](https://expo.dev) SDK 57 | App platform and the `expo-*` modules below | MIT |
| `expo-router` | Navigation | MIT |
| `expo-document-picker`, `expo-image-picker`, `expo-image-manipulator` | Picking and resizing PDFs and photos | MIT |
| `expo-file-system`, `expo-secure-store`, `expo-sharing`, `expo-asset` | Storage, API key, sharing | MIT |
| `expo-haptics`, `expo-notifications`, `expo-splash-screen`, `expo-font`, `expo-constants`, `expo-linking`, `expo-status-bar` | Feedback, notifications and app shell | MIT |
| [React Native](https://reactnative.dev) 0.86 and [React](https://react.dev) 19 (Meta) | UI | MIT |
| `react-native-webview` | Hosting the PDF worker | MIT |
| `react-native-screens`, `react-native-safe-area-context` | Navigation support | MIT |
| `@expo/vector-icons` | Icons | MIT |
| [TypeScript](https://www.typescriptlang.org) | Language | Apache-2.0 |

**Services**

- [Google AI Studio](https://aistudio.google.com) (Gemini API) serves Gemma 4 by default. [OpenRouter](https://openrouter.ai) is an optional alternative.
- [EAS Build](https://expo.dev/eas) compiles the APK in the cloud.

## Commits after the deadline

The challenge deadline was **Monday 5 October 2026, 12:29 PM IST**. Any commit made after it is listed here so judges can tell what was part of the submission.

| Commit | Date (IST) | What changed |
|---|---|---|
| _None so far_ | | |

## License

[MIT](LICENSE) © 2026 Rupam Das
