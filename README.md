# Receipts — Local-First WhatsApp Catch-Up Ledger

**Receipts** is a client-only AI micro-app designed to solve *"The Unread Problem — What Did I Miss?"* Instead of a generic paragraph summary that can hallucinate or hide critical details, Receipts builds a living **ledger** of your unread WhatsApp conversations directly inside your browser tab.

## Core Features

1. **RECEIPTS (Verifiable Source Quotes)**: Every task, deadline, decision, and question in the ledger links to the exact source message(s) where it was stated. Tapping **Receipts (n)** slides open the real chat transcript with the cited messages highlighted and 3 messages of surrounding context before and after. An AI-extracted item is shown **only** if a deterministic verifier (`src/engine/pipeline/verify.ts`) confirms its quotes truly exist verbatim in the cited messages and its assigned owner is a real chat participant.
2. **REVISIONS (Living State History)**: Chat plans change constantly—deadlines get postponed, tasks get completed, or meetings get cancelled. Receipts scans chronological messages after an item's creation and tracks how it evolved. Cards display the latest state while preserving the old values struck through (`11 Mar 18:00` &rarr; **`14 Mar 18:00`**) along with who changed it and a direct link to the update message. Ambiguous update messages that could match multiple items are skipped rather than guessed.

---

## Gen AI Attribution

Gen AI used: Gemma 2 2B-it (Google open model) running in the browser via WebLLM/WebGPU to extract tasks, decisions and deadlines (src/engine/llm). Google AI Studio and GitHub Copilot were used for development and deployment. No chat data is sent to any Gen AI API.

---

## How to Run Locally

```bash
# 1. Install dependencies
npm install

# 2. Run unit and pipeline tests (Vitest)
npm test

# 3. Start local development server (http://localhost:3000)
npm run dev

# 4. Build production static bundle
npm run build

# 5. Serve production bundle (defaults to 0.0.0.0:8080 or $PORT)
npm start
```

---

## How to Get a Chat & How to Test (for Reviewers)

### How to test (for reviewers)
Export any WhatsApp chat without media (**More** &rarr; **Export chat** &rarr; **Without media**) and upload the `.txt`, or paste chat text into the paste box; choose your name; click **"Quick scan (rules only)"** for instant rules-only results, or **"Load AI model"** then **"Scan with AI"** for local AI results (first load downloads the model once, then it is cached).

### Example Format Accepted by the Paste Box
If you don't have a `.txt` file handy on your desktop, you can type or paste any valid WhatsApp export lines into the **Paste chat text** box in Step 1 (both Android and iOS formats, 12-hour and 24-hour clocks, English and Roman-script Hinglish are supported).

---

## Architecture Summary

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full pipeline diagram.

- **Parser (`src/engine/parser/whatsapp.ts`)**: Parses Android (`dd/mm/yy, h:mm am - Sender: text`) and iOS (`[dd/mm/yy, hh:mm:ss] Sender: text`) exports through a single code path, strips `U+200E`, converts `U+202F` narrow no-break spaces, detects `dd/mm` vs `mm/dd`, joins multi-line messages, and flags system/media lines.
- **Rules & Hinglish Date Resolution (`src/engine/rules/*`)**: All linguistic cues live in `src/engine/rules/lexicon.json`. Relative dates (including Hinglish terms like `aaj`, `kal`, `parso`, `subah`, `dopahar`, `shaam`, `raat`, `tak`) are normalized and resolved via `chrono-node` (`chrono.en.GB`) strictly against **the message's own timestamp**, never today's clock.
- **Scoping & Chunking (`src/engine/pipeline/chunk.ts`)**: Scans unread messages (at or after your chosen *"I last read"* cutoff) plus up to 300 earlier messages as context for matching revisions. Builds overlapping windows (~30 messages / ~1500 tokens, 4-message overlap) processed newest-first.
- **WebLLM Worker & Verifier (`src/engine/llm/*`, `src/engine/pipeline/verify.ts`)**: Runs `gemma-2-2b-it-q4f16_1-MLC` (Full) or `Llama-3.2-1B-Instruct-q4f16_1-MLC` (Lite) inside a Web Worker. Every extracted item is verified for verbatim quote existence and real participant ownership before entering the ledger.
- **Reconciler & Prioritizer (`src/engine/pipeline/reconcile.ts`, `src/engine/pipeline/prioritize.ts`)**: Merges cross-window duplicates, attaches unambiguous chronological revisions, scores items by urgency/ownership, and places them into **Needs you now**, **Soon**, and **FYI** lanes.

---

## Privacy & Local-First Guarantee

- **Zero Server Uploads**: Your chat transcript, extracted items, receipts, and catch-up brief are processed 100% inside your browser tab. No chat data is ever sent to any cloud API or backend server.
- **Zero Chat Persistence**: Chat messages are kept strictly in volatile memory (`zustand` store) and vanish when you close/refresh the tab or click **Clear my data**. Only your display name and nicknames are saved in `localStorage`.
- **Verifiable in DevTools**: Open DevTools &rarr; **Network**, scan a chat, and confirm zero outbound requests contain chat content. Once the WebLLM model is cached in browser storage, you can toggle **Offline** mode and run full AI scans with no internet connection.

---

## Limitations

1. **Rules-Only Mode Uses Linguistic Heuristics**: When WebGPU is unavailable or when you run **Quick scan (rules only)**, extraction relies on deterministic heuristics defined in `src/engine/rules/lexicon.json` (matching date expressions paired with commitment/request cues, or questions mentioning your name/nicknames). Implicit tasks phrased without lexicon cue words or dates may be missed in Rules-only mode.
2. **WebGPU Browser Support & First-Time Model Download**: Local AI mode requires a browser and GPU supporting WebGPU (best in Chrome or Edge on desktop). The first time you click **Load AI model**, the quantized model weights (~1.0–1.5 GB) are downloaded from Hugging Face CDN and cached in the browser's Cache API/IndexedDB for offline reuse.
3. **Ambiguous Updates Are Intentionally Skipped**: To prevent false history, the revision reconciler skips update messages (e.g., *"That's done"*) if they do not share a distinctive term with a single clear target item.

---

## Cloud Run Deployment & Security Reference

Receipts is a pure client-side static application, so no runtime API keys or cloud databases are invoked by the app. If deploying to Google Cloud Run for hosting or challenge verification, you can build and deploy using the included `Dockerfile` and `nginx.conf`:

### 1. Deploy to Google Cloud Run

```bash
# Enable Cloud Run & Cloud Build APIs
gcloud services enable run.googleapis.com cloudbuild.googleapis.com

# Build and deploy the static nginx container to Cloud Run
gcloud run deploy receipts \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --port 8080
```

### 2. Apply Verification Label (If Participating in Cloud Run Challenge)

```bash
gcloud run services update receipts \
  --update-labels=dev-tutorial=cloud-run-ai-challenge \
  --region=asia-southeast1
```

### 3. Enterprise Reference Patterns (Secret Manager & Firestore Isolation)

While Receipts strictly avoids cloud databases and external API keys by design, production cloud extensions that add optional cloud sync or server APIs should follow zero-hardcoding and owner-bound isolation:

```javascript
// Reference Firestore Security Rules (User Data Isolation)
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/interactions/{interactionId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

```bash
# Reference Secret Manager Binding
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"
echo -n "YOUR_API_KEY" | gcloud secrets versions add GEMINI_API_KEY --data-file=-

gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --member="serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```
