# Receipts Architecture

Receipts is a 100% client-side, local-first web application that transforms overwhelming unread WhatsApp chat exports into a living ledger of tasks, decisions, deadlines, and questions. Every item in the ledger is backed by verifiable source message quotes (**Receipts**) and tracks state mutations across time (**Revisions**).

## High-Level Data Flow

```text
WhatsApp .txt / Pasted Text
         │
         ▼
┌────────────────────────────────────────┐
│ 1. Parser (src/engine/parser/whatsapp) │
│  • Strip U+200E, normalize U+202F      │
│  • Auto-detect dd/mm vs mm/dd          │
│  • Support Android & iOS, 12h & 24h    │
│  • Join multi-line & tag system lines  │
└────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│ 2. Scope & Chunker (pipeline/chunk.ts) │
│  • Unread (ts >= lastReadTs) + up to   │
│    300 earlier context messages        │
│  • Filter noise (system, media, acks)  │
│  • Build ~30-msg / ~1500-token windows │
│    with 4-msg overlap (newest first)   │
└────────────────────────────────────────┘
         │
         ├────────────────────────────────────────────┐
         ▼ (Optional Local WebGPU AI)                 ▼ (Always-Available Deterministic Rules)
┌────────────────────────────────────────┐   ┌────────────────────────────────────────┐
│ 3a. WebLLM Worker (engine/llm/*)       │   │ 3b. Rules Extractor (rules/cues,dates) │
│  • Runs inside Web Worker              │   │  • Driven by rules/lexicon.json        │
│  • Gemma 2 2B (Full) / Llama 3.2 1B    │   │  • Hinglish date normalizer + chrono   │
│  • Structured JSON schema + 1 retry    │   │  • Mention & edit-distance nickname    │
└────────────────────────────────────────┘   └────────────────────────────────────────┘
         │                                            │
         ▼                                            │
┌────────────────────────────────────────┐            │
│ 4. Quote Verifier (pipeline/verify.ts) │            │
│  • Every evidence msgId must exist     │            │
│  • Normalized quote must appear        │            │
│    verbatim in cited message           │            │
│  • Owner must be a real participant    │            │
│  • Re-parses dates relative to msg.ts  │            │
└────────────────────────────────────────┘            │
         │                                            │
         └────────────────────┬───────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────┐
│ 5. Reconciler (src/engine/pipeline/reconcile.ts)    │
│  • Deduplicate across windows (title Jaccard >= 0.6)│
│  • Replay messages chronologically                  │
│  • Match updates requiring change/done/cancel cues  │
│    + shared distinctive terms + single clear winner │
│  • Record Revisions (from -> to, by sender, msgId)  │
│  • Enforce scope visibility filter                  │
└─────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────┐
│ 6. Prioritizer & Deterministic Brief                │
│  • Score items (overdue, 24h, 72h, onMe, changed)   │
│  • Route into Needs you now, Soon, FYI lanes        │
│  • Assemble deterministic Catch-up brief            │
└─────────────────────────────────────────────────────┘
```

## Module Breakdown

1. **`src/domain/types.ts`**: Pure TypeScript domain definitions (`Msg`, `Receipt`, `Revision`, `LedgerItem`, `CatchUpBrief`).
2. **`src/engine/parser/whatsapp.ts`**: Parses Android and iOS `.txt` exports and pasted transcripts through a single code path, enforcing a 20 MB file size ceiling.
3. **`src/engine/rules/*`**:
   - `lexicon.json`: Editable linguistic data containing Hinglish temporal tokens, past-tense markers, stop words, and cue categories (`commitment`, `request`, `question`, `change`, `done`, `cancel`).
   - `dates.ts`: Hinglish date normalizer feeding into `chrono.en.GB` with `forwardDate: true`, resolving all relative dates strictly against the message's own timestamp (`msg.ts`).
   - `mentions.ts`: Case-insensitive whole-word, `@handle`, and Levenshtein edit-distance matching for user names and nicknames.
   - `cues.ts`: Phrase matcher and distinctive term extractor.
4. **`src/engine/llm/*`**:
   - `select.ts`: Inspects `navigator.gpu.requestAdapter()` buffer limits against `webllm.prebuiltAppConfig.model_list` (`vram_required_MB` and `buffer_size_required_bytes`) to choose between Full (`gemma-2-2b-it-q4f16_1-MLC`) and Lite (`Llama-3.2-1B-Instruct-q4f16_1-MLC`), falling back to Rules-only if WebGPU is unavailable.
   - `worker.ts` & `engine.ts`: Runs `@mlc-ai/web-llm` inside a dedicated Web Worker (`CreateWebWorkerMLCEngine`) so the UI never freezes during inference.
5. **`src/engine/pipeline/*`**:
   - `chunk.ts`: Scopes unread messages plus up to 300 context messages, strips noise, and constructs overlapping windows ordered newest-first.
   - `verify.ts`: Rejects any LLM item whose cited message ID is missing, whose quote is not verbatim after normalization, or whose owner is not a real chat participant.
   - `reconcile.ts`: Deduplicates items and scans subsequent messages in chronological order to attach `Revision` records (`due` date shifts, `done`, `cancelled`) while rejecting ambiguous matches.
   - `prioritize.ts`: Computes urgency scores, human-readable reason tags, and assigns items to `now`, `soon`, or `fyi` lanes.
   - `brief.ts`: Deterministically formats the top Catch-up brief from computed counts and items without generative prose.
   - `run.ts`: Orchestrates progressive window scanning, cancellation, and live state snapshots.
