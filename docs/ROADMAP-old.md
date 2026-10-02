# Paperwise — Build Roadmap & Antigravity Prompts

Deadline: **Monday 5 Oct, 12:29 PM IST**. Submit by **11:30 AM**. All times IST.

## Ground rules
- `AGENTS.md` in the repo root before starting `agy`.
- One milestone at a time. **Test on the phone → commit → next.** Commit format: `M5: paper import + review`.
- After each milestone, add numbers/surprises to **section 17 (Findings log)** of AGENTS.md.
- New `agy` session → use the **Resume prompt** first.
- Milestone taking > 1.5× its time box → use the **Cut list**.
- Before Sunday: get **2–3 real PYQ papers + the syllabus** for one subject whose exam is coming up (yours, and ideally one a classmate is taking).

## Timeline

| When | Milestone | Must-have? |
|---|---|---|
| Fri 15:45–16:30 | Setup (you) | ✅ |
| Fri 16:30–18:30 | M0 + M1: skeleton + AI feasibility | ✅ |
| Fri 18:30–21:00 | M2: subjects + storage | ✅ |
| Fri 21:00–21:30 | M2b: first APK build (runs in cloud overnight) | ✅ |
| Sat 09:00–11:30 | M3: PDF worker | ✅ |
| Sat 11:30–14:00 | M4: syllabus import + review | ✅ |
| Sat 14:00–19:00 | M5: paper import + review | ✅ |
| Sat 19:00–23:00 | M6: topic labels + topic view + All questions | ✅ |
| Sun 09:00–11:00 | M7: repeat groups | ✅ |
| Sun 11:00–13:30 | M8: practice mode | ✅ |
| Sun 13:30–15:00 | M9: share/open subject | ✅ (cut 2nd) |
| Sun 15:00–16:00 | Accuracy test on a real paper (Findings) | ✅ |
| Sun 16:00–18:30 | M10: polish + final APK | ✅ |
| Sun 18:30–21:00 | Send to a classmate, record demo, screenshots | ✅ |
| Mon 06:00–10:30 | Write the DEV post | ✅ |
| Mon 10:30–11:30 | M11: README, release, submit | ✅ |

## Setup (you, Fri 15:45–16:30)
1. Create a new public GitHub repo `paperwise`. Add `AGENTS.md`, `ROADMAP.md`, `HANDOFF.md`. Commit: `Initial commit: project plan`.
2. Google AI Studio → create an API key → in a model's "Get code", copy the **exact Gemma 4 model ID**. Note the free-tier limits shown.
3. Optional: OpenRouter account + key; note the free Gemma 4 model ID.
4. Expo account; Expo Go on your phone. Laptop: Node LTS, Git, `agy`, `npm install -g eas-cli`.
5. Photograph or download one PYQ page to test M1.

## M0 + M1 — Skeleton + AI feasibility (Fri 16:30–18:30)
```
Read AGENTS.md fully. Do milestones M0 and M1 only.

M0: create the Expo app in app/ (TypeScript, Expo Router, Expo Go compatible only), the theme from section 10 (light/dark), a navigation shell with Home and Settings, root .gitignore, README stub.

M1:
- src/ai/client.ts with generateJSON() for Google AI Studio (default) and OpenRouter, exactly as section 7 (temperature 0, JSON extraction, one retry, friendly errors, ignore thinking parts).
- src/ai/prompts.ts with the page→questions prompt from 8.2, and src/ai/validators.ts for it.
- Settings screen: provider, API key stored in expo-secure-store (masked), model ID (defaults from src/config.ts), "Test key" button.
- A dev "Test page" screen: pick one photo (expo-image-picker), resize to ~1600 px JPEG 0.8, call 8.2, show time taken, raw response, and the parsed questions list.

Model ID for AI Studio: [PASTE FROM AI STUDIO]. Don't run anything heavy locally. When done, tell me how to run it with npx expo start --tunnel and what to check.
```
**Done when:** a real PYQ photo → correct-looking questions with marks on your phone. Record **seconds per page** and any misreads in Findings.

## M2 — Subjects + storage (Fri 18:30–21:00)
```
M1 works ([time per page], [notes]). Do milestone M2 from AGENTS.md:
- storage in src/store using expo-file-system exactly as section 5 (subjects.json + subjects/{id}.json), with simple versioning
- Home screen with subject cards and empty state (section 10, screen 1)
- + Add subject: name, code, units and topics (add/rename/delete/reorder with up/down buttons)
- Subject screen shell with tabs Topics | All questions | Papers (empty states for now)
Keep the Test page screen reachable from Settings.
```

## M2b — First APK (Fri 21:00–21:30)
```
Do M2b: set up EAS Build for an Android APK — eas.json with a "preview" profile using "buildType": "apk", app.config.ts with name "Paperwise", slug, Android package, placeholder icon and splash. Give me the exact commands to log in, build in the cloud, and install the APK.
```
**You:** `eas login`, `eas build -p android --profile preview`. Let it build; install in the morning.

## M3 — PDF worker (Sat 09:00–11:30)
```
Do milestone M3 (section 4, "PDF worker"):
- hidden react-native-webview loading a LOCAL html page with pdf.js (legacy build) bundled via expo-asset — no CDN
- app picks a PDF with expo-document-picker, sends it as base64 (chunked if large)
- for each page return {type:"text", text} if it has a real text layer (>200 non-space chars), else {type:"image", base64} rendered at ~1600 px long edge, JPEG 0.8
- one page at a time, progress callback, worker kept alive
- a dev screen to pick a PDF and show page-by-page results
Read section 11 pitfalls first. Explain how to test with one text PDF and one scanned PDF.
```

## M4 — Syllabus import (Sat 11:30–14:00)
```
Do milestone M4 (section 8.1 and screen 2):
- Import syllabus from PDF (via the PDF worker), photos, or pasted text
- one Gemma call if ≤ 6 pages, else per page + merge
- validator + Syllabus review screen: subjects with units and topics, rename/delete/merge/add, checkbox per subject, Create subjects
- ask for an API key with the bottom sheet from section 7 if none is saved
```
**Done when:** your real syllabus becomes correct subject folders after small edits.

## M5 — Paper import + review (Sat 14:00–19:00)
```
Do milestone M5 (section 8.2 and screen 4):
- Add papers to a subject from PDFs or photos; each page → text or image → one Gemma call per page, sequential queue
- pass the previous page's last question number; merge continues_previous; detect year from the paper
- save page images; resume from the last finished page after errors or 429
- Paper review screen: page image (tap to zoom) above its questions; edit number/text/marks/type/group; delete; add missing question; inline warnings (marks null, numbering gaps, very short text) as in section 6
- Save paper → stored in the subject; Papers tab lists papers
```
**You:** import 2–3 real papers. Count correct questions and marks → Findings.

## M6 — Topic labels + views (Sat 19:00–23:00)
```
Do milestone M6 (section 8.3, section 9, screens 3, 5, 6):
- after saving a paper, label its questions with topic IDs in chunks of ≤ 25; validate; unknown → Unassigned
- src/logic: times asked, topic weight, unit weight, high-priority badge, default sort — pure functions with unit tests
- Topics tab with weight bars and badges; Topic view with sorted question cards; Move to topic; low-confidence chip
- All questions tab with sort options and filter chips
User edits must never be overwritten by AI re-runs.
```
**You:** hand-label one paper's topics and compare → Findings.

## M7 — Repeat groups (Sun 09:00–11:00)
```
Do milestone M7 (section 8.4): repeat grouping per affected topic, validation, repeatGroupId, one card per group with "Asked n× (years)" and expandable versions. Update times-asked in src/logic and its tests.
```

## M8 — Practice (Sun 11:00–13:30)
```
Do milestone M8 (section 9 practice + screen 8): setup (topics multi-select, filters, High priority only), weighted random flashcards, Got it / Revise with haptics, progress per topic, end summary. Practice state saved in the subject file.
```

## M9 — Share / open subject (Sun 13:30–15:00)
```
Do milestone M9 (section 10, Sharing): export a subject as {name}.paperwise.json without practice state (page images off by default), share via expo-sharing; "Open shared subject" imports it with validation. No API key needed to open.
```

## Accuracy test (Sun 15:00–16:00, you)
On one subject: questions extracted correctly / total, marks correct / total, topics correct / total, repeats found. Write the numbers in Findings. These are the core of your write-up.

## M10 — Polish + final APK (Sun 16:00–18:30)
```
Do milestone M10: empty, loading, error and offline states on every screen; dark mode check; app icon and splash; haptics; accessibility labels; About in Settings ("Powered by Gemma 4, an open model"), privacy note. Remove or hide dev screens. Then list anything rough you noticed.
```
**You:** `eas build -p android --profile preview` → install → full run-through.

## Sun 18:30–21:00 — Real person + demo (you)
- Pick a classmate with an upcoming exam. Send them the APK **and** a ready shared subject file for that exam: "I made a topic-wise breakdown of past papers for [subject], want it?"
- Write down exactly what they say (even one line). Don't invent anything.
- Record 1–2 min on your phone: import syllabus → subjects appear → add a scanned paper → review beside the page → topic view sorted by marks/repeats → practice → share the file.
- Screenshots: Home, Syllabus review, Paper review, Topic view, Practice.

## Mon 06:00–10:30 — DEV post (you, with AI help)
Fill `docs/devto_post_draft.md` with real numbers and the real quote.

## M11 — Submit (Mon 10:30–11:30)
```
Do milestone M11: final README.md — description, screenshots placeholders, text architecture diagram, how to get a free key, setup for the app, credits for every open model and library (Gemma 4, pdf.js, Expo, React Native, etc.), a note that an earlier prototype existed in Google AI Studio but no code was reused, and a section for commits after the deadline.
```
**You:** GitHub Release with the APK, publish the post, submit **before 11:30**.

## Cut list (in this order)
1. Backboard comparison
2. OpenRouter provider (keep AI Studio)
3. Filters in All questions (keep sorting)
4. Page-image zoom in review (keep the image)
5. Share/open subject (M9)
6. Merge controls in Syllabus review (keep rename/delete/add)

**Never cut:** paper import + review, topic labelling, topic-wise sorting, repeats, practice, the demo video, the write-up.

## Reusable prompts
**Resume:**
```
Read AGENTS.md. Done: [list]. Current: [Mx]. Last thing that worked: [...]. Continue from there in small steps.
```
**Fix:**
```
This is broken: [what I did / expected / happened]. Error: [paste]. Find the cause first and explain it in two sentences, then make the smallest fix. Don't rewrite unrelated code.
```
**Check (before commit):**
```
Review this milestone's changes against AGENTS.md. List anything that breaks sections 3, 6, 7 or 11, leftover debug code, and any hard-coded keys.
```
