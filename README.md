# PYQed

Turn your university syllabus and past year question papers into a smart, topic-wise question bank.

**Powered by [Gemma 4](https://ai.google.dev/gemma), an open-weight model by Google DeepMind.**

> 🚧 Built during the DEV.to Hacktoberfest Weekend Challenge 2026.

## What it does

1. Import a syllabus → subjects with units and topics
2. Add scanned PYQ papers → Gemma 4 reads and extracts every question
3. See which topics carry the most marks and which questions keep repeating
4. Practice with flashcards, share your analysis with classmates

## Setup

```bash
cd app
npm install
npx expo start --tunnel
```

Scan the QR code with Expo Go on your Android or iOS phone.

## Architecture

Everything runs on the phone. No backend. AI calls use **your own free Google AI Studio API key** (or OpenRouter, or any OpenAI-compatible provider) and Gemma 4.

## License

MIT
