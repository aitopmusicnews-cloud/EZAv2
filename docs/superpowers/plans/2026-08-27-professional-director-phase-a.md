# Professional Director Phase A — Lyrics + Song Understanding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fake audio-only “song understanding” with a professional Phase A pipeline that automatically transcribes the uploaded song, lets the user correct/replace lyrics, aligns official lyrics to timing, generates structured Song Understanding, and blocks the heuristic Director from professional generation.

**Architecture:** Keep EZAv2’s existing song upload, librosa analysis, project persistence, Agnes generation stack, and Advanced Editor. Add server-side OpenAI provider adapters for dual-pass transcription (`gpt-transcribe` for wording + `whisper-1` for timestamps) and structured Song Understanding (`gpt-5.6` Responses API), pure lyric reconciliation/alignment modules, shared Zod contracts, new Fastify Director routes, Zustand persistence/approval state, and guided Lyrics/Understanding UI steps. The old `createDirectorPlan(AudioAnalysis, vision, bible)` remains parseable only as a legacy plan and is not allowed to drive Professional Director generation.

**Tech Stack:** TypeScript 5.6, Node.js 22, Fastify 5, Zod 3, React 19, Zustand 5, Vitest 4, FFmpeg, existing Python/librosa audio analysis, OpenAI Audio Transcriptions API, OpenAI Responses API structured outputs.

**Spec:** `docs/superpowers/specs/2026-08-27-professional-music-video-director-design.md`

## Global Constraints

- BeatSync must not claim lyrical meaning from BPM/energy/section timing alone.
- For songs with vocals, lyrics must be approved before semantic Song Understanding can be generated.
- Instrumental Mode is an explicit user choice; it is never inferred silently.
- Song Understanding must be approved before any future Professional Treatment is unlocked.
- The current heuristic Director must not be a Professional Director generation path.
- Agnes image/video generation remains unchanged in Phase A except for a guard that rejects legacy heuristic plans.
- Existing Advanced Editor functionality remains available.
- Existing saved projects remain parseable; old Director plans are labeled legacy rather than silently upgraded.
- Provider credentials remain server-side environment variables and are never stored in project snapshots.
- `OPENAI_API_KEY` is required only for auto-transcription and Song Understanding; missing configuration returns a clear 503 rather than fabricating output.
- Global Negative Prompt and Production Bible behavior from the approved spec remain unchanged in Phase A.
- Full `pnpm build`, strict TypeScript build, targeted Vitest tests, and the existing Python audio-analysis test must pass before deployment.

---

## File Structure

### Shared contracts
- Modify `packages/shared/src/index.ts` — add lyric, Song Understanding, request/response, expanded stage, and legacy-plan metadata schemas.
- Create `packages/shared/src/professional-director-phase-a.test.ts` — contract and migration tests.

### API
- Modify `apps/api/src/config.ts` — add server-side OpenAI configuration/model defaults.
- Create `apps/api/src/transcriptionAudio.ts` — safely transcode the stored song URL to a transcription-ready MP3 buffer.
- Create `apps/api/src/openaiTranscription.ts` — provider interface + OpenAI dual-pass transcription implementation.
- Create `apps/api/src/lyricAlignment.ts` — pure transcript reconciliation and official-lyrics alignment.
- Create `apps/api/src/songUnderstanding.ts` — OpenAI Responses structured-output client and prompt.
- Create `apps/api/src/directorPhaseARoutes.ts` — Fastify routes for transcribe, align lyrics, and understand.
- Modify `apps/api/src/server.ts` — register Phase A routes.
- Create `apps/api/src/openaiTranscription.test.ts` — provider parsing/request contract tests with mocked fetch.
- Create `apps/api/src/lyricAlignment.test.ts` — deterministic alignment tests.
- Create `apps/api/src/songUnderstanding.test.ts` — structured output and refusal/error tests.
- Create `apps/api/src/directorPhaseARoutes.test.ts` — route validation/gating tests with injected provider functions.

### Web
- Modify `apps/web/src/lib/api.ts` — add Phase A client calls.
- Modify `apps/web/src/lib/store.ts` — persist lyric/understanding state, approvals, invalidation, stages, and legacy plan safety.
- Modify `apps/web/src/lib/store.test.ts` — persistence and approval-gate tests.
- Modify `apps/web/src/lib/director.ts` — stamp the existing planner as `legacy-audio-heuristic`.
- Modify `apps/web/src/lib/directorActions.ts` — refuse Professional Director generation from legacy plans.
- Modify `apps/web/src/components/DirectorWorkspace.tsx` — replace immediate Plan creation with Lyrics and Understanding steps.
- Modify `apps/web/src/styles/director.css` — lyrics/understanding review layouts and horizontally scrollable stage navigation.
- Create `apps/web/src/components/DirectorPhaseA.contract.test.ts` — UI flow text/button/gate contract.

---

### Task 1: Define Phase A shared contracts and migration-safe stages

**Files:**
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/professional-director-phase-a.test.ts`

**Interfaces:**
- Produces: `LyricWord`, `LyricSegment`, `LyricDocument`, `SongUnderstanding`, `SongUnderstandingSection`, `KeyLyricMoment`, `TranscribeSongRequest`, `AlignOfficialLyricsRequest`, `SongUnderstandingRequest`.
- Produces: expanded `DirectorStage` and `DirectorPlan.planningBasis`.
- Consumed by all API/web tasks below.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import {
  DirectorPlan,
  DirectorStage,
  LyricDocument,
  SongUnderstanding,
} from "./index.js";

describe("Professional Director Phase A contracts", () => {
  it("supports the professional stages while retaining legacy clips parsing", () => {
    expect(DirectorStage.parse("lyrics")).toBe("lyrics");
    expect(DirectorStage.parse("understanding")).toBe("understanding");
    expect(DirectorStage.parse("treatment")).toBe("treatment");
    expect(DirectorStage.parse("takes")).toBe("takes");
    expect(DirectorStage.parse("edit")).toBe("edit");
  });

  it("requires timed segments for a vocal lyric document", () => {
    const parsed = LyricDocument.safeParse({
      source: "hybrid",
      rawText: "I know where I am going",
      segments: [{ id: "l1", start: 1, end: 3, text: "I know where I am going", source: "official-aligned" }],
      words: [{ start: 1, end: 1.2, text: "I" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts instrumental documents with no lyrics", () => {
    expect(LyricDocument.parse({ source: "instrumental", rawText: "", segments: [] }).source).toBe("instrumental");
  });

  it("marks historical DirectorPlan v1 as legacy when planningBasis is absent", () => {
    const plan = DirectorPlan.parse({
      id: "p1",
      version: 1,
      vision: "",
      treatment: { title: "Legacy", concept: "x", style: "x", pacing: "x" },
      shots: [{
        id: "s1", clipId: "c1", start: 0, end: 3, sectionLabel: "section 1",
        role: "Performance", idea: "x", camera: "wide", framing: "wide",
        mood: "x", location: "x", energy: 0.5, hero: false,
      }],
    });
    expect(plan.planningBasis).toBe("legacy-audio-heuristic");
  });

  it("requires Song Understanding uncertainty to be explicit", () => {
    const parsed = SongUnderstanding.safeParse({
      basis: "lyrics+music",
      primaryTheme: "reclaiming control",
      secondaryThemes: ["separation"],
      emotionalArc: ["isolation", "confrontation", "freedom"],
      sections: [], keyLyricMoments: [], repeatedHooks: [], characters: [],
      narrativePerspective: "first person",
      literalImagery: [], symbolicImagery: [], tensionRelease: [],
      performanceOpportunities: [], visualMotifs: [], uncertaintyNotes: ["speaker identity is ambiguous"],
    });
    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the shared contract test and verify RED**

Run: `pnpm exec vitest run packages/shared/src/professional-director-phase-a.test.ts`

Expected: FAIL because the new schemas/stages do not exist.

- [ ] **Step 3: Add exact schemas to `packages/shared/src/index.ts`**

Add these shapes, using Zod for every API-bound object:

```ts
export const LyricWord = z.object({
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
  text: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

export const LyricSegment = z.object({
  id: z.string().min(1),
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(["transcription", "official-aligned", "manual"]),
}).refine((v) => v.end >= v.start, { message: "lyric segment end must be >= start" });

export const LyricDocument = z.object({
  source: z.enum(["transcription", "official", "hybrid", "instrumental"]),
  rawText: z.string(),
  draftText: z.string().optional(),
  language: z.string().optional(),
  segments: z.array(LyricSegment),
  words: z.array(LyricWord).optional(),
  correctedAt: z.number().optional(),
  approvedAt: z.number().optional(),
});

export const KeyLyricMoment = z.object({
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
  lyric: z.string().min(1),
  meaning: z.string().min(1),
  visualOpportunity: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
});

export const SongUnderstandingSection = z.object({
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
  sourceLabel: z.string().min(1),
  inferredRole: z.string().min(1),
  lyricalPurpose: z.string().min(1),
  musicalPurpose: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
});

export const SongUnderstanding = z.object({
  basis: z.enum(["lyrics+music", "instrumental+vision"]),
  primaryTheme: z.string().min(1),
  secondaryThemes: z.array(z.string()),
  emotionalArc: z.array(z.string()).min(1),
  sections: z.array(SongUnderstandingSection),
  keyLyricMoments: z.array(KeyLyricMoment),
  repeatedHooks: z.array(z.string()),
  characters: z.array(z.string()),
  narrativePerspective: z.string().min(1),
  literalImagery: z.array(z.string()),
  symbolicImagery: z.array(z.string()),
  tensionRelease: z.array(z.string()),
  performanceOpportunities: z.array(z.string()),
  visualMotifs: z.array(z.string()),
  uncertaintyNotes: z.array(z.string()),
  approvedAt: z.number().optional(),
});
```

Also change `DirectorStage` to the professional stage list and make snapshot parsing migration-safe with a separate legacy stage schema:

```ts
export const DirectorStage = z.enum([
  "song", "lyrics", "understanding", "treatment", "plan", "images", "takes", "edit", "final",
]);
const SnapshotDirectorStage = z.enum([
  "song", "lyrics", "understanding", "treatment", "plan", "images", "clips", "takes", "edit", "final",
]);
```

Extend `DirectorPlan`:

```ts
planningBasis: z.enum(["legacy-audio-heuristic", "professional-treatment"])
  .default("legacy-audio-heuristic"),
```

Add API request schemas:

```ts
export const TranscribeSongRequest = z.object({
  songId: z.string().min(1).max(100),
  audioUrl: z.string().url(),
  duration: z.number().finite().positive(),
});
export const AlignOfficialLyricsRequest = z.object({
  draft: LyricDocument,
  officialText: z.string().trim().min(1).max(50_000),
});
export const SongUnderstandingRequest = z.object({
  lyrics: LyricDocument,
  analysis: AudioAnalysis,
  vision: z.string().max(12_000).default(""),
});
```

Persist `lyricDocument` and `songUnderstanding` in `ProjectSnapshot`, with `directorStage: SnapshotDirectorStage.optional()`.

- [ ] **Step 4: Run shared contracts GREEN**

Run: `pnpm exec vitest run packages/shared/src/professional-director-phase-a.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/professional-director-phase-a.test.ts
git commit -m "feat: add professional Director lyric contracts"
```

---

### Task 2: Add OpenAI server configuration without exposing credentials

**Files:**
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/src/config.ts` through build/typecheck; no secret-value tests.

**Interfaces:**
- Produces: `config.OPENAI_API_KEY`, `config.TRANSCRIPTION_TEXT_MODEL`, `config.TRANSCRIPTION_TIMING_MODEL`, `config.SONG_UNDERSTANDING_MODEL`.
- Consumed by Tasks 4 and 6.

- [ ] **Step 1: Add environment schema fields**

```ts
OPENAI_API_KEY: optionalNonEmpty.optional(),
TRANSCRIPTION_TEXT_MODEL: z.string().min(1).default("gpt-transcribe"),
TRANSCRIPTION_TIMING_MODEL: z.string().min(1).default("whisper-1"),
SONG_UNDERSTANDING_MODEL: z.string().min(1).default("gpt-5.6"),
```

- [ ] **Step 2: Add a startup warning, not a startup failure**

```ts
if (!config.OPENAI_API_KEY) {
  console.warn(
    "WARN: OPENAI_API_KEY is not set. Automatic lyric transcription and Song Understanding are offline; manual/official lyric entry remains available."
  );
}
```

Do not log the key and do not add it to project state, API responses, or browser code.

- [ ] **Step 3: Verify API typecheck**

Run: `pnpm --filter @mvs/api typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/config.ts
git commit -m "feat: configure Director language providers"
```

---

### Task 3: Prepare a safe transcription audio buffer

**Files:**
- Create: `apps/api/src/transcriptionAudio.ts`
- Create: `apps/api/src/transcriptionAudio.test.ts`

**Interfaces:**
- Consumes: `assertSafeHost(url)` and existing `runFfmpeg(args)`.
- Produces: `prepareTranscriptionAudio(audioUrl: string, songId: string): Promise<{ buffer: Buffer; filename: string; mimeType: "audio/mpeg" }>`.

- [ ] **Step 1: Write a failing URL ownership validation test**

```ts
import { describe, expect, it } from "vitest";
import { assertSongUrlMatchesId } from "./transcriptionAudio.js";

describe("transcription audio safety", () => {
  it("requires the uploaded song id in the storage filename", () => {
    expect(() => assertSongUrlMatchesId(
      "https://ezav2.onrender.com/storage/uploads/abc123.mp3",
      "abc123"
    )).not.toThrow();
    expect(() => assertSongUrlMatchesId(
      "https://example.com/unrelated.mp3",
      "abc123"
    )).toThrow(/does not match uploaded song/i);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run apps/api/src/transcriptionAudio.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement safe preprocessing**

`assertSongUrlMatchesId` must parse the URL and require the final filename stem to begin with the content-addressed `songId`.

`prepareTranscriptionAudio` must:
1. call `assertSongUrlMatchesId(audioUrl, songId)`,
2. call `assertSafeHost(audioUrl)` for remote URLs,
3. transcode via FFmpeg to mono MP3 at 96 kbps,
4. read the temp file into a Buffer,
5. always delete the temp file in `finally`,
6. reject buffers larger than `24 * 1024 * 1024` bytes with a clear message.

Core FFmpeg call:

```ts
await runFfmpeg([
  "-i", audioUrl,
  "-vn",
  "-ac", "1",
  "-ar", "44100",
  "-c:a", "libmp3lame",
  "-b:a", "96k",
  "-y", tempPath,
]);
```

Return `{ buffer, filename: `${songId}-transcription.mp3`, mimeType: "audio/mpeg" }`.

- [ ] **Step 4: Run GREEN**

Run: `pnpm exec vitest run apps/api/src/transcriptionAudio.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/transcriptionAudio.ts apps/api/src/transcriptionAudio.test.ts
git commit -m "feat: prepare safe transcription audio"
```

---

### Task 4: Implement dual-pass OpenAI transcription and reconcile timing

**Files:**
- Create: `apps/api/src/openaiTranscription.ts`
- Create: `apps/api/src/openaiTranscription.test.ts`
- Create: `apps/api/src/lyricAlignment.ts`
- Create: `apps/api/src/lyricAlignment.test.ts`

**Interfaces:**
- Produces: `TranscriptionProvider`.
- Produces: `OpenAITranscriptionProvider.transcribe(input): Promise<LyricDocument>`.
- Produces: `reconcileAccurateTextWithTiming(accurateText, whisperWords, whisperSegments): LyricDocument`.
- Consumed by Task 7 routes.

- [ ] **Step 1: Write failing reconciliation tests**

```ts
import { describe, expect, it } from "vitest";
import { reconcileAccurateTextWithTiming } from "./lyricAlignment.js";

describe("dual-pass lyric reconciliation", () => {
  it("uses accurate wording but preserves monotonic Whisper timing", () => {
    const doc = reconcileAccurateTextWithTiming(
      "I know where I'm going",
      [
        { text: "I", start: 1.0, end: 1.2 },
        { text: "no", start: 1.2, end: 1.5 },
        { text: "where", start: 1.5, end: 1.9 },
        { text: "im", start: 1.9, end: 2.1 },
        { text: "going", start: 2.1, end: 2.6 },
      ],
      [{ start: 1.0, end: 2.6, text: "I no where im going" }],
    );
    expect(doc.rawText).toBe("I know where I'm going");
    expect(doc.words?.[0]?.start).toBe(1.0);
    expect(doc.words?.at(-1)?.end).toBe(2.6);
    expect(doc.segments[0]?.text).toContain("know");
  });
});
```

- [ ] **Step 2: Write failing provider request tests with mocked `fetch`**

Test that the provider sends two multipart requests to `/v1/audio/transcriptions`:
- wording pass model = `gpt-transcribe`,
- timing pass model = `whisper-1`, `response_format=verbose_json`, both `timestamp_granularities[]=word` and `timestamp_granularities[]=segment`.

The test must return synthetic provider payloads and assert the resulting `LyricDocument` is `source: "transcription"`.

- [ ] **Step 3: Run RED**

Run: `pnpm exec vitest run apps/api/src/lyricAlignment.test.ts apps/api/src/openaiTranscription.test.ts`

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement monotonic token reconciliation**

Use normalized lowercase alphanumeric/apostrophe tokens. Use dynamic-programming edit-distance alignment between the accurate transcript tokens and timestamped Whisper tokens. Matched/substituted accurate tokens inherit Whisper timings; unmatched accurate tokens interpolate between the nearest timed neighbors; leading/trailing unmatched tokens clamp to the first/last known interval.

Keep these exported helpers small and testable:

```ts
export type ProviderTimedWord = { text: string; start: number; end: number };
export type ProviderTimedSegment = { text: string; start: number; end: number };

export function reconcileAccurateTextWithTiming(
  accurateText: string,
  timedWords: ProviderTimedWord[],
  timedSegments: ProviderTimedSegment[],
): LyricDocument;
```

Generate segment text by selecting reconciled words whose midpoint lies inside each provider segment; if a segment receives no words, preserve its provider text and mark lower confidence.

- [ ] **Step 5: Implement `OpenAITranscriptionProvider` with built-in `fetch`/`FormData`**

Do not add the OpenAI npm SDK in Phase A; Node 22 already provides `fetch`, `FormData`, and `Blob`.

```ts
export interface TranscriptionProvider {
  transcribe(input: { buffer: Buffer; filename: string; mimeType: string }): Promise<LyricDocument>;
}
```

For both requests set `Authorization: Bearer ${config.OPENAI_API_KEY}`. Throw a provider error containing HTTP status + safe API error message, never the key/request headers.

Run the two calls with `Promise.all` after the single preprocessing step.

- [ ] **Step 6: Run GREEN**

Run: `pnpm exec vitest run apps/api/src/lyricAlignment.test.ts apps/api/src/openaiTranscription.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/openaiTranscription.ts apps/api/src/openaiTranscription.test.ts apps/api/src/lyricAlignment.ts apps/api/src/lyricAlignment.test.ts
git commit -m "feat: transcribe lyrics with reconciled timing"
```

---

### Task 5: Align pasted official lyrics to the transcription timeline

**Files:**
- Modify: `apps/api/src/lyricAlignment.ts`
- Modify: `apps/api/src/lyricAlignment.test.ts`

**Interfaces:**
- Consumes: approved/draft `LyricDocument` with timed `words`.
- Produces: `alignOfficialLyrics(draft: LyricDocument, officialText: string): LyricDocument`.

- [ ] **Step 1: Add failing official-lyrics tests**

```ts
it("uses official wording while preserving approximate line timing", () => {
  const aligned = alignOfficialLyrics(draft, [
    "I know where I'm going",
    "I won't turn around",
  ].join("\n"));

  expect(aligned.source).toBe("hybrid");
  expect(aligned.rawText).toContain("I know where I'm going");
  expect(aligned.segments).toHaveLength(2);
  expect(aligned.segments[0]!.start).toBeLessThan(aligned.segments[1]!.start);
  expect(aligned.segments.every((s) => s.source === "official-aligned")).toBe(true);
});

it("interpolates an unmatched official line between matched neighbors", () => {
  const aligned = alignOfficialLyrics(draft, "first known line\nnew unmatched line\nlast known line");
  expect(aligned.segments[1]!.start).toBeGreaterThanOrEqual(aligned.segments[0]!.end);
  expect(aligned.segments[1]!.end).toBeLessThanOrEqual(aligned.segments[2]!.start);
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run apps/api/src/lyricAlignment.test.ts`

Expected: FAIL because `alignOfficialLyrics` is missing.

- [ ] **Step 3: Implement line-aware alignment**

Algorithm:
1. split official text into non-empty lines,
2. tokenize each line while retaining line ownership,
3. align all official tokens to draft timed words with the same monotonic DP matcher,
4. for each line use first/last matched word time,
5. interpolate completely unmatched lines between nearest matched line boundaries weighted by token count,
6. enforce monotonic non-overlapping start/end values,
7. preserve the draft in `draftText`, set `rawText=officialText`, `source="hybrid"`, `correctedAt=Date.now()`, and clear `approvedAt`.

If the draft has no timing words, throw `Official lyrics need a timed transcription before automatic alignment.` The UI will still let the user choose Instrumental Mode or retry transcription; do not fabricate timestamps.

- [ ] **Step 4: Run GREEN**

Run: `pnpm exec vitest run apps/api/src/lyricAlignment.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lyricAlignment.ts apps/api/src/lyricAlignment.test.ts
git commit -m "feat: align official lyrics to song timing"
```

---

### Task 6: Implement structured Song Understanding

**Files:**
- Create: `apps/api/src/songUnderstanding.ts`
- Create: `apps/api/src/songUnderstanding.test.ts`

**Interfaces:**
- Consumes: `SongUnderstandingRequest`.
- Produces: `generateSongUnderstanding(request): Promise<SongUnderstanding>`.
- Consumed by Task 7 route.

- [ ] **Step 1: Write a failing structured-response test**

Mock `fetch` to return a Responses API payload containing one `output_text` content item with JSON matching `SongUnderstanding`. Assert:
- `basis` is `lyrics+music` for vocal documents,
- lyric-specific claims use supplied lyric text,
- `uncertaintyNotes` is always present,
- result passes `SongUnderstanding.parse`.

Also add tests that:
- an unapproved vocal `LyricDocument` is rejected before any provider call,
- `source: "instrumental"` is accepted only when `lyrics.approvedAt` is present,
- a provider refusal/no output_text becomes a clear error.

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run apps/api/src/songUnderstanding.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement the Responses API request**

Use `POST https://api.openai.com/v1/responses` with:

```ts
{
  model: config.SONG_UNDERSTANDING_MODEL,
  input: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify({ lyrics, analysis, vision }) },
  ],
  text: {
    format: {
      type: "json_schema",
      name: "song_understanding",
      strict: true,
      schema: SONG_UNDERSTANDING_JSON_SCHEMA,
    },
  },
}
```

The system prompt must include these rules verbatim in meaning:
- never infer a lyric meaning from BPM/energy alone,
- distinguish literal lyrics from interpretation,
- cite key lyric moments using supplied lyric text and supplied timings,
- use generic audio sections as timing evidence, not as proof of verse/chorus labels,
- mark uncertainty explicitly,
- for instrumental mode, base interpretation on musical structure + user vision and set `basis="instrumental+vision"`.

Extract the first `output[].content[]` item with `type === "output_text"`, `JSON.parse` it, then validate with `SongUnderstanding.parse`.

- [ ] **Step 4: Run GREEN**

Run: `pnpm exec vitest run apps/api/src/songUnderstanding.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/songUnderstanding.ts apps/api/src/songUnderstanding.test.ts
git commit -m "feat: generate structured song understanding"
```

---

### Task 7: Add testable Phase A Fastify routes

**Files:**
- Create: `apps/api/src/directorPhaseARoutes.ts`
- Create: `apps/api/src/directorPhaseARoutes.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- `POST /api/director/transcribe` consumes `TranscribeSongRequest`, returns `LyricDocument`.
- `POST /api/director/align-lyrics` consumes `AlignOfficialLyricsRequest`, returns `LyricDocument`.
- `POST /api/director/understand` consumes `SongUnderstandingRequest`, returns `SongUnderstanding`.

- [ ] **Step 1: Write failing route tests using `Fastify().register(...)`**

Inject dependencies so tests never call OpenAI/FFmpeg:

```ts
export type DirectorPhaseADeps = {
  prepareAudio: typeof prepareTranscriptionAudio;
  transcriptionProvider: Pick<TranscriptionProvider, "transcribe">;
  alignOfficialLyrics: typeof alignOfficialLyrics;
  generateUnderstanding: typeof generateSongUnderstanding;
};
```

Tests must assert:
- transcribe returns 503 when provider configuration is absent,
- invalid/mismatched song URLs return 400,
- alignment accepts only a valid `LyricDocument` + non-empty official text,
- understanding rejects unapproved lyrics with 400,
- successful calls return schema-valid objects.

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run apps/api/src/directorPhaseARoutes.test.ts`

Expected: FAIL because the route plugin does not exist.

- [ ] **Step 3: Implement the plugin**

```ts
export async function directorPhaseARoutes(app: FastifyInstance, deps: DirectorPhaseADeps) {
  app.post("/api/director/transcribe", { config: { rateLimit: { max: 4, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!config.OPENAI_API_KEY) return reply.code(503).send({ error: "Automatic lyric transcription is not configured. Paste official lyrics or configure OPENAI_API_KEY." });
    const input = TranscribeSongRequest.parse(req.body);
    const audio = await deps.prepareAudio(input.audioUrl, input.songId);
    return reply.send(await deps.transcriptionProvider.transcribe(audio));
  });

  app.post("/api/director/align-lyrics", async (req, reply) => {
    const input = AlignOfficialLyricsRequest.parse(req.body);
    return reply.send(deps.alignOfficialLyrics(input.draft, input.officialText));
  });

  app.post("/api/director/understand", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!config.OPENAI_API_KEY) return reply.code(503).send({ error: "Song Understanding is not configured. Configure OPENAI_API_KEY." });
    const input = SongUnderstandingRequest.parse(req.body);
    if (!input.lyrics.approvedAt) return reply.code(400).send({ error: "Approve lyrics before Song Understanding." });
    return reply.send(await deps.generateUnderstanding(input));
  });
}
```

Register it from `server.ts` with real dependencies after the common middleware is registered.

- [ ] **Step 4: Run GREEN**

Run: `pnpm exec vitest run apps/api/src/directorPhaseARoutes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/directorPhaseARoutes.ts apps/api/src/directorPhaseARoutes.test.ts apps/api/src/server.ts
git commit -m "feat: expose Director lyrics and understanding APIs"
```

---

### Task 8: Add browser API clients and persistent approval state

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/store.ts`
- Modify: `apps/web/src/lib/store.test.ts`

**Interfaces:**
- Produces browser functions: `transcribeSong`, `alignOfficialLyricsApi`, `requestSongUnderstanding`.
- Store produces: `lyricDocument`, `songUnderstanding`, `setLyricDocument`, `updateLyricSegment`, `approveLyrics`, `markInstrumental`, `setSongUnderstanding`, `updateSongUnderstanding`, `approveSongUnderstanding`.

- [ ] **Step 1: Add failing store tests**

Tests must cover:
1. `loadSong` clears previous lyric/understanding state and sets stage `lyrics` only after the UI requests it; initial stage remains `song`.
2. `setLyricDocument` clears Song Understanding and downstream plan approval.
3. `approveLyrics` refuses an empty vocal document.
4. `markInstrumental` creates an approved instrumental document only through an explicit action.
5. editing a lyric segment clears lyric approval + Song Understanding + active Director plan approval.
6. editing Song Understanding clears its `approvedAt` and downstream plan approval.
7. snapshots persist/restore lyric and understanding objects.
8. a historical snapshot with `directorStage: "clips"` restores safely as `directorStage: "takes"` while preserving its old plan as legacy.

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run apps/web/src/lib/store.test.ts`

Expected: FAIL on the new Phase A tests.

- [ ] **Step 3: Add API client functions**

```ts
export async function transcribeSong(req: TranscribeSongRequest): Promise<LyricDocument> { /* POST /api/director/transcribe */ }
export async function alignOfficialLyricsApi(req: AlignOfficialLyricsRequest): Promise<LyricDocument> { /* POST /api/director/align-lyrics */ }
export async function requestSongUnderstanding(req: SongUnderstandingRequest): Promise<SongUnderstanding> { /* POST /api/director/understand */ }
```

Use the existing `jsonOrThrow` error path.

- [ ] **Step 4: Implement store state + invalidation**

Add fields:

```ts
lyricDocument: LyricDocument | null;
songUnderstanding: SongUnderstanding | null;
```

Add actions with deterministic invalidation. `approveLyrics()` must set `approvedAt=Date.now()` only when:
- source is `instrumental`, or
- at least one non-empty segment exists.

`markInstrumental()` must create exactly:

```ts
{
  source: "instrumental",
  rawText: "",
  segments: [],
  approvedAt: Date.now(),
}
```

When lyric/understanding content changes, clear:
- `songUnderstanding` or its approval as appropriate,
- `directorPlan.approvedAt`,
- `directorFinalUrl`,
- any Director image/video approvals if a plan exists.

Do not delete previously generated media URLs; mark the active plan stale/legacy instead.

Normalize restored `directorStage === "clips"` to `"takes"`.

- [ ] **Step 5: Run GREEN**

Run: `pnpm exec vitest run apps/web/src/lib/store.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/store.ts apps/web/src/lib/store.test.ts
git commit -m "feat: persist Director lyrics and understanding"
```

---

### Task 9: Explicitly retire the heuristic planner from Professional generation

**Files:**
- Modify: `apps/web/src/lib/director.ts`
- Modify: `apps/web/src/lib/directorActions.ts`
- Create: `apps/web/src/lib/professionalDirectorGate.test.ts`

**Interfaces:**
- Existing `createDirectorPlan` continues returning a `DirectorPlan`, but always with `planningBasis: "legacy-audio-heuristic"`.
- Professional generation requires `planningBasis === "professional-treatment"`.

- [ ] **Step 1: Write failing safety tests**

```ts
it("stamps the old planner as legacy audio heuristic", () => {
  const plan = createDirectorPlan(analysis, "night city", {});
  expect(plan.planningBasis).toBe("legacy-audio-heuristic");
});

it("refuses storyboard generation from a legacy plan", async () => {
  useStore.setState({ directorPlan: legacyApprovedPlan, productionBible: { negativePrompt: "watermark" } } as any);
  await expect(generateStoryboardImage("shot-1")).rejects.toThrow(/legacy Director plan/i);
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run apps/web/src/lib/professionalDirectorGate.test.ts`

Expected: FAIL because current plans are not explicitly legacy and generation only checks approval.

- [ ] **Step 3: Add the legacy stamp and generation guard**

In `createDirectorPlan` return:

```ts
planningBasis: "legacy-audio-heuristic",
```

At the top of every Director-owned generation path (`generateStoryboardImage`, batch images, Director videos, Director final render), call:

```ts
function requireProfessionalPlan() {
  const plan = useStore.getState().directorPlan;
  if (!plan) throw new Error("No Director plan is loaded.");
  if (plan.planningBasis !== "professional-treatment") {
    throw new Error("This is a Legacy Director plan. Upgrade through Lyrics → Song Understanding → Treatment before Professional Director generation.");
  }
  return plan;
}
```

Do not change generic Advanced Editor generation functions; manual Agnes tools remain available there.

- [ ] **Step 4: Run GREEN**

Run: `pnpm exec vitest run apps/web/src/lib/professionalDirectorGate.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/director.ts apps/web/src/lib/directorActions.ts apps/web/src/lib/professionalDirectorGate.test.ts
git commit -m "fix: block heuristic plans from professional generation"
```

---

### Task 10: Build the Lyrics + Understanding guided UI

**Files:**
- Modify: `apps/web/src/components/DirectorWorkspace.tsx`
- Modify: `apps/web/src/styles/director.css`
- Create: `apps/web/src/components/DirectorPhaseA.contract.test.ts`

**Interfaces:**
- Consumes Phase A store actions and browser API functions.
- Produces user-visible stages: Song → Lyrics → Understanding, with later professional stages visible but locked.

- [ ] **Step 1: Write failing UI contract tests**

Read `DirectorWorkspace.tsx` as source text and assert it contains these exact user-facing controls and does not expose the old main-flow `Create Video Plan` button:

```ts
expect(source).toContain("2. Lyrics");
expect(source).toContain("3. Understanding");
expect(source).toContain("Verify the lyrics");
expect(source).toContain("Paste official lyrics");
expect(source).toContain("Align Official Lyrics");
expect(source).toContain("Mark as instrumental");
expect(source).toContain("Approve Lyrics");
expect(source).toContain("Analyze Song Meaning");
expect(source).toContain("Approve Song Understanding");
expect(source).toContain("Uncertainties");
expect(source).not.toContain(">Create Video Plan<");
```

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run apps/web/src/components/DirectorPhaseA.contract.test.ts`

Expected: FAIL because the current workspace jumps Song → Plan.

- [ ] **Step 3: Update stage navigation**

Use:

```ts
const STEP_LABELS = [
  "1. Song", "2. Lyrics", "3. Understanding", "4. Treatment", "5. Plan",
  "6. Images", "7. Takes", "8. Edit", "9. Final",
] as const;
```

Make the stepper horizontally scrollable. Only unlock:
- Song always,
- Lyrics when song + analysis exist,
- Understanding when `lyricDocument.approvedAt` exists,
- Treatment only when `songUnderstanding.approvedAt` exists **and Phase B treatment data exists**. Since Phase B is not implemented, Treatment remains disabled after Phase A and shows a clear `Professional Treatment is the next implementation phase` status card after understanding approval.

- [ ] **Step 4: Change song upload behavior**

After `uploadSong` succeeds:
1. store the song,
2. set stage to `lyrics`,
3. call `transcribeSong({ songId, audioUrl, duration })`,
4. store the returned `LyricDocument`.

If transcription fails, keep the song loaded and stay on Lyrics. Show the real error plus:
- Retry Transcription,
- Paste Official Lyrics (only auto-aligns after a timed draft exists),
- Mark as instrumental.

Do not fail/unload the song because transcription failed.

- [ ] **Step 5: Implement `LyricsStep`**

Show each segment as `timestamp + editable text`. Segment edits set `source: "manual"` and clear lyric approval.

Add an official-lyrics textarea labeled `Paste official lyrics`. The `Align Official Lyrics` button calls the API and replaces the draft with the returned hybrid document.

Primary controls:
- Retry Transcription
- Mark as instrumental
- Approve Lyrics
- Analyze Song Meaning (enabled only after approval)

After Approve Lyrics + Analyze, call `requestSongUnderstanding({ lyrics, analysis, vision })`, store it, and advance to Understanding.

- [ ] **Step 6: Implement `UnderstandingStep`**

Render editable plain-English sections:
- Theme
- Emotional Arc
- Key Lyrics
- Section Map
- Narrative
- Visual Motifs
- Performance Moments
- Uncertainties

Include `Re-analyze` and `Approve Song Understanding`.

Editing any field calls `updateSongUnderstanding` and clears approval.

After approval show:

`Song Understanding approved. BeatSync now has a verified semantic foundation. Professional Treatment is the next stage; the old BPM/energy heuristic planner is disabled.`

Keep `Advanced Editor` accessible at all times.

- [ ] **Step 7: Add CSS**

Add focused classes for:
- `.director-lyrics-grid`
- `.director-lyric-row`
- `.director-official-lyrics`
- `.director-understanding-grid`
- `.director-confidence`
- `.director-stage-locked`

Do not change the existing dark/orange design tokens.

- [ ] **Step 8: Run UI contract GREEN + web typecheck**

Run:

```bash
pnpm exec vitest run apps/web/src/components/DirectorPhaseA.contract.test.ts
pnpm --filter @mvs/web typecheck
```

Expected: both PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/DirectorWorkspace.tsx apps/web/src/styles/director.css apps/web/src/components/DirectorPhaseA.contract.test.ts
git commit -m "feat: add lyric and song understanding review flow"
```

---

### Task 11: Full Phase A regression verification

**Files:**
- Modify only if verification exposes a real defect.

**Interfaces:**
- Validates the complete Phase A slice and existing EZAv2/Agnes behavior.

- [ ] **Step 1: Run all targeted Phase A tests**

```bash
pnpm exec vitest run \
  packages/shared/src/professional-director-phase-a.test.ts \
  apps/api/src/transcriptionAudio.test.ts \
  apps/api/src/lyricAlignment.test.ts \
  apps/api/src/openaiTranscription.test.ts \
  apps/api/src/songUnderstanding.test.ts \
  apps/api/src/directorPhaseARoutes.test.ts \
  apps/web/src/lib/store.test.ts \
  apps/web/src/lib/professionalDirectorGate.test.ts \
  apps/web/src/components/DirectorPhaseA.contract.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the existing repository test suite**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 3: Run strict typechecks and production build**

```bash
pnpm typecheck
pnpm build
```

Expected: PASS with no TypeScript errors and successful Vite/API builds.

- [ ] **Step 4: Run the existing Python audio-analysis regression**

```bash
cd audio_analysis
PYTHONPATH=. python3 -m unittest test_audio_analysis -v
```

Expected: PASS.

- [ ] **Step 5: Verify no client bundle contains the OpenAI credential name as a read path**

Run:

```bash
grep -R "process.env.OPENAI_API_KEY\|import.meta.env.*OPENAI_API_KEY" apps/web packages/shared && exit 1 || exit 0
```

Expected: exit 0 with no matches.

- [ ] **Step 6: Verify the old heuristic cannot generate in the Director path**

Run the professional gate test again after all integrations:

`pnpm exec vitest run apps/web/src/lib/professionalDirectorGate.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit any verification-only fixes separately**

Only if verification required code changes:

```bash
git add <exact changed files>
git commit -m "fix: close Phase A regression gaps"
```

If no fixes were needed, do not create an empty commit.

---

## Phase A Acceptance Checklist

Phase A is complete only when all of these are demonstrably true:

- Uploading a song still produces the existing librosa `AudioAnalysis`.
- The UI advances to Lyrics instead of generating a heuristic video plan.
- Auto-transcription failure does not lose the uploaded song.
- Auto transcription produces timed draft lyrics.
- Pasted official lyrics replace wording and align to draft timing.
- The user can manually correct timed lyric segments.
- Instrumental Mode requires an explicit user action.
- Vocal lyrics must be approved before Song Understanding.
- Song Understanding is structured, editable, uncertainty-aware, and approval-gated.
- Editing lyrics invalidates Song Understanding and downstream approvals.
- Editing Song Understanding invalidates downstream approvals.
- The old energy/BPM planner is explicitly labeled `legacy-audio-heuristic`.
- Legacy heuristic plans cannot generate storyboard/video/final output through the Professional Director.
- Advanced Editor remains available for manual work.
- Historical project snapshots remain parseable.
- `OPENAI_API_KEY` stays server-side.
- Targeted tests, full tests, strict typechecks, production build, and audio-analysis regression all pass before any Render deployment.

## Provider Notes Verified for This Plan

As of 2026-08-27, current OpenAI documentation recommends `gpt-transcribe` for general file transcription, while word/segment timestamp granularities are supported on `whisper-1`. Phase A therefore uses both behind one provider adapter: `gpt-transcribe` supplies the preferred wording, `whisper-1` supplies word/segment timing, and deterministic alignment reconciles them. Song Understanding uses `gpt-5.6` with Responses API Structured Outputs and validates the returned JSON again with the shared Zod schema.
