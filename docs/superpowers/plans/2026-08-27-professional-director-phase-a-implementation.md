# Professional Director Phase A — Lyrics + Song Understanding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BeatSync stop pretending BPM/energy equals song meaning by adding timed lyric transcription, official-lyrics correction/alignment, structured Song Understanding, explicit approvals, and a hard block on legacy heuristic Director generation.

**Architecture:** Preserve EZAv2’s existing song upload/librosa analysis, Agnes provider stack, Production Bible, project persistence, FFmpeg render path, and Advanced Editor. Add server-only OpenAI adapters behind small interfaces: `gpt-transcribe` supplies preferred transcript wording, `whisper-1` supplies word/segment timestamps, deterministic alignment reconciles them, and `gpt-5.6` Responses Structured Outputs produces validated Song Understanding. The browser stores approved lyrics/understanding in Zustand/project snapshots and the guided flow becomes Song → Lyrics → Understanding; Treatment and later Professional Director stages stay locked until later phases.

**Tech Stack:** TypeScript 5.6, Node.js 22, Fastify 5, Zod 3, React 19, Zustand 5, Vitest 4, FFmpeg, existing Python/librosa analyzer, OpenAI Audio Transcriptions API, OpenAI Responses API.

**Spec:** `docs/superpowers/specs/2026-08-27-professional-music-video-director-design.md`

## Global Constraints

- BeatSync must never derive lyric meaning, characters, relationships, or metaphors from BPM/energy/section timing alone.
- Vocal songs require approved lyric context before Song Understanding.
- Instrumental Mode is explicit user intent and is never auto-detected as a bypass.
- Generic analyzer labels such as `section 1` are timing evidence, not proof of verse/chorus names.
- Song Understanding is editable, uncertainty-aware, and separately approved.
- The existing heuristic `createDirectorPlan(AudioAnalysis, vision, bible)` remains readable only as a legacy plan and cannot drive Professional Director image/video/final generation.
- Existing Advanced Editor manual generation remains available.
- Existing project snapshots must remain parseable, including historical `directorStage: "clips"`.
- `OPENAI_API_KEY` stays server-side and is never emitted in project snapshots or browser code.
- Missing OpenAI configuration produces clear 503 responses; no fabricated lyrics or semantic output.
- Auto-transcription failure must not discard the uploaded song; official lyrics can still be saved while timing remains unresolved.
- Global Negative Prompt and current Production Bible behavior are untouched in Phase A.
- No Render deployment until targeted tests, full tests, strict typechecks, production build, and existing Python analyzer regression pass.

---

## File Map

### Shared
- Modify `packages/shared/src/index.ts` — Phase A Zod contracts, migration-safe stages, legacy plan metadata, snapshot fields.
- Create `packages/shared/src/professional-director-phase-a.test.ts` — schema/migration contracts.

### API
- Modify `apps/api/src/config.ts` — server-only OpenAI/model configuration.
- Create `apps/api/src/transcriptionAudio.ts` — validate trusted stored-song URL and FFmpeg transcode for transcription.
- Create `apps/api/src/lyricAlignment.ts` — dual-pass reconciliation + official-line alignment.
- Create `apps/api/src/openaiTranscription.ts` — provider adapter and OpenAI transcription calls.
- Create `apps/api/src/songUnderstanding.ts` — structured semantic analysis.
- Create `apps/api/src/directorPhaseARoutes.ts` — dependency-injected Fastify plugin.
- Modify `apps/api/src/server.ts` — register plugin with real dependencies.
- Create matching `*.test.ts` files for each new API module.

### Web
- Modify `apps/web/src/lib/api.ts` — Phase A API clients.
- Modify `apps/web/src/lib/store.ts` — lyric/understanding state, persistence, approval invalidation, stage migration.
- Modify `apps/web/src/lib/store.test.ts` — state contracts.
- Modify `apps/web/src/lib/director.ts` — mark existing planner legacy.
- Modify `apps/web/src/lib/directorActions.ts` — professional-plan generation guard.
- Create `apps/web/src/lib/professionalDirectorGate.test.ts` — legacy plan refusal tests.
- Modify `apps/web/src/components/DirectorWorkspace.tsx` — Song/Lyrics/Understanding guided workflow.
- Modify `apps/web/src/styles/director.css` — Phase A layouts and scrollable stage navigation.
- Create `apps/web/src/components/DirectorPhaseA.contract.test.ts` — user-flow contract.

---

### Task 1: Add migration-safe Phase A shared contracts

**Files:**
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/professional-director-phase-a.test.ts`

**Interfaces:**
- Produces `LyricWord`, `LyricSegment`, `LyricDocument`, `KeyLyricMoment`, `SongUnderstandingSection`, `SongUnderstanding`.
- Produces `TranscribeSongRequest`, `AlignOfficialLyricsRequest`, `SongUnderstandingRequest`.
- Extends `DirectorPlan` with `planningBasis`.
- Extends `ProjectSnapshot` with `lyricDocument` and `songUnderstanding`.

- [ ] **Step 1: Write failing shared contract tests**

```ts
import { describe, expect, it } from "vitest";
import { DirectorPlan, DirectorStage, LyricDocument, ProjectSnapshot, SongUnderstanding } from "./index.js";

describe("Professional Director Phase A contracts", () => {
  it("accepts new professional stages and the legacy clips alias", () => {
    for (const stage of ["lyrics", "understanding", "treatment", "takes", "edit", "clips"]) {
      expect(DirectorStage.safeParse(stage).success).toBe(true);
    }
  });

  it("defaults historical plans to legacy audio heuristic", () => {
    const plan = DirectorPlan.parse({
      id: "p1", version: 1, vision: "",
      treatment: { title: "Legacy", concept: "x", style: "x", pacing: "x" },
      shots: [{
        id: "s1", clipId: "c1", start: 0, end: 3, sectionLabel: "section 1",
        role: "Performance", idea: "x", camera: "wide", framing: "wide",
        mood: "x", location: "x", energy: 0.5, hero: false,
      }],
    });
    expect(plan.planningBasis).toBe("legacy-audio-heuristic");
  });

  it("persists lyrics and understanding in project snapshots", () => {
    const snap = ProjectSnapshot.parse({
      lyricDocument: { source: "instrumental", rawText: "", segments: [], approvedAt: 1 },
      songUnderstanding: {
        basis: "instrumental+vision", primaryTheme: "forward motion", secondaryThemes: [],
        emotionalArc: ["restraint", "release"], sections: [], keyLyricMoments: [], repeatedHooks: [],
        characters: [], narrativePerspective: "non-lyrical", literalImagery: [], symbolicImagery: [],
        tensionRelease: [], performanceOpportunities: ["final drop"], visualMotifs: [], uncertaintyNotes: [],
      },
    });
    expect(snap.lyricDocument?.source).toBe("instrumental");
  });

  it("requires explicit uncertainty storage", () => {
    expect(SongUnderstanding.safeParse({
      basis: "lyrics+music", primaryTheme: "reclaiming control", secondaryThemes: [],
      emotionalArc: ["isolation", "freedom"], sections: [], keyLyricMoments: [], repeatedHooks: [],
      characters: [], narrativePerspective: "first person", literalImagery: [], symbolicImagery: [],
      tensionRelease: [], performanceOpportunities: [], visualMotifs: [], uncertaintyNotes: ["speaker target is ambiguous"],
    }).success).toBe(true);
  });

  it("allows an official-only untimed draft but not a fabricated timed document", () => {
    const doc = LyricDocument.parse({ source: "official", rawText: "official words", segments: [] });
    expect(doc.segments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run packages/shared/src/professional-director-phase-a.test.ts`

Expected: FAIL because Phase A schemas do not exist.

- [ ] **Step 3: Implement exact shared schemas**

Add:

```ts
export const LyricWord = z.object({
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
  text: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
}).refine((v) => v.end >= v.start, { message: "lyric word end must be >= start" });
export type LyricWord = z.infer<typeof LyricWord>;

export const LyricSegment = z.object({
  id: z.string().min(1),
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(["transcription", "official-aligned", "manual"]),
}).refine((v) => v.end >= v.start, { message: "lyric segment end must be >= start" });
export type LyricSegment = z.infer<typeof LyricSegment>;

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
export type LyricDocument = z.infer<typeof LyricDocument>;
```

Add the Song Understanding contracts:

```ts
export const KeyLyricMoment = z.object({
  start: z.number().finite().min(0), end: z.number().finite().min(0), lyric: z.string().min(1),
  meaning: z.string().min(1), visualOpportunity: z.string().min(1), confidence: z.enum(["high", "medium", "low"]),
});
export const SongUnderstandingSection = z.object({
  start: z.number().finite().min(0), end: z.number().finite().min(0), sourceLabel: z.string().min(1),
  inferredRole: z.string().min(1), lyricalPurpose: z.string().min(1), musicalPurpose: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
});
export const SongUnderstanding = z.object({
  basis: z.enum(["lyrics+music", "instrumental+vision"]),
  primaryTheme: z.string().min(1), secondaryThemes: z.array(z.string()), emotionalArc: z.array(z.string()).min(1),
  sections: z.array(SongUnderstandingSection), keyLyricMoments: z.array(KeyLyricMoment), repeatedHooks: z.array(z.string()),
  characters: z.array(z.string()), narrativePerspective: z.string().min(1), literalImagery: z.array(z.string()),
  symbolicImagery: z.array(z.string()), tensionRelease: z.array(z.string()), performanceOpportunities: z.array(z.string()),
  visualMotifs: z.array(z.string()), uncertaintyNotes: z.array(z.string()), approvedAt: z.number().optional(),
});
export type SongUnderstanding = z.infer<typeof SongUnderstanding>;
```

For Phase A compatibility, keep `clips` as a deprecated stage alias so existing code compiles while the UI migrates:

```ts
export const DirectorStage = z.enum([
  "song", "lyrics", "understanding", "treatment", "plan", "images", "clips", "takes", "edit", "final",
]);
```

Extend `DirectorPlan`:

```ts
planningBasis: z.enum(["legacy-audio-heuristic", "professional-treatment"]).default("legacy-audio-heuristic"),
```

Add API schemas:

```ts
export const TranscribeSongRequest = z.object({
  songId: z.string().min(1).max(100), audioUrl: z.string().url(), duration: z.number().finite().positive(),
});
export type TranscribeSongRequest = z.infer<typeof TranscribeSongRequest>;

export const AlignOfficialLyricsRequest = z.object({
  draft: LyricDocument, officialText: z.string().trim().min(1).max(50_000),
});
export type AlignOfficialLyricsRequest = z.infer<typeof AlignOfficialLyricsRequest>;

export const SongUnderstandingRequest = z.object({
  lyrics: LyricDocument, analysis: AudioAnalysis, vision: z.string().max(12_000).default(""),
});
export type SongUnderstandingRequest = z.infer<typeof SongUnderstandingRequest>;
```

Add optional `lyricDocument` and `songUnderstanding` to `ProjectSnapshot`.

- [ ] **Step 4: Run GREEN and shared build**

```bash
pnpm exec vitest run packages/shared/src/professional-director-phase-a.test.ts
pnpm --filter @mvs/shared build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/professional-director-phase-a.test.ts
git commit -m "feat: add professional Director lyric contracts"
```

---

### Task 2: Add server-only provider configuration

**Files:**
- Modify: `apps/api/src/config.ts`

**Interfaces:**
- Produces `config.OPENAI_API_KEY`, `config.TRANSCRIPTION_TEXT_MODEL`, `config.TRANSCRIPTION_TIMING_MODEL`, `config.SONG_UNDERSTANDING_MODEL`.

- [ ] **Step 1: Add configuration fields**

```ts
OPENAI_API_KEY: optionalNonEmpty.optional(),
TRANSCRIPTION_TEXT_MODEL: z.string().min(1).default("gpt-transcribe"),
TRANSCRIPTION_TIMING_MODEL: z.string().min(1).default("whisper-1"),
SONG_UNDERSTANDING_MODEL: z.string().min(1).default("gpt-5.6"),
```

- [ ] **Step 2: Add a non-fatal configuration warning**

```ts
if (!config.OPENAI_API_KEY) {
  console.warn(
    "WARN: OPENAI_API_KEY is not set. Automatic lyric transcription and Song Understanding are offline; official lyrics can still be saved for later alignment."
  );
}
```

- [ ] **Step 3: Verify API typecheck**

Run: `pnpm --filter @mvs/api typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/config.ts
git commit -m "feat: configure Director language providers"
```

---

### Task 3: Prepare transcription audio from trusted EZAv2 storage

**Files:**
- Create: `apps/api/src/transcriptionAudio.ts`
- Create: `apps/api/src/transcriptionAudio.test.ts`

**Interfaces:**
- Produces `prepareTranscriptionAudio(audioUrl, songId)`.
- Uses existing `runFfmpeg`.

- [ ] **Step 1: Write failing trusted-host tests**

```ts
import { describe, expect, it } from "vitest";
import { assertTrustedSongUrl } from "./transcriptionAudio.js";

describe("transcription source validation", () => {
  it("accepts the configured app host and matching content id", () => {
    expect(() => assertTrustedSongUrl(
      "http://localhost:3001/storage/uploads/abc123.mp3", "abc123",
      ["localhost:3001"]
    )).not.toThrow();
  });

  it("rejects a different host even when the filename contains the id", () => {
    expect(() => assertTrustedSongUrl(
      "https://attacker.example/abc123.mp3", "abc123",
      ["ezav2.onrender.com"]
    )).toThrow(/trusted EZAv2 storage host/i);
  });

  it("rejects a trusted host when the stored filename does not match the song id", () => {
    expect(() => assertTrustedSongUrl(
      "https://ezav2.onrender.com/storage/uploads/other.mp3", "abc123",
      ["ezav2.onrender.com"]
    )).toThrow(/uploaded song id/i);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run apps/api/src/transcriptionAudio.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement trusted-host validation and FFmpeg transcode**

Build the trusted host list from `PUBLIC_BASE_URL` plus `S3_PUBLIC_URL_BASE` when configured. Do not call the generic SSRF guard for a validated same-app localhost URL; reject all hosts outside the trusted list instead.

```ts
export function assertTrustedSongUrl(audioUrl: string, songId: string, trustedHosts: string[]): void {
  const url = new URL(audioUrl);
  if (!trustedHosts.includes(url.host)) throw new Error("audio URL is not on a trusted EZAv2 storage host");
  const filename = url.pathname.split("/").at(-1) ?? "";
  if (!filename.startsWith(`${songId}.`) && !filename.startsWith(`${songId}-`)) {
    throw new Error("audio URL does not match the uploaded song id");
  }
}
```

Implement:

```ts
export async function prepareTranscriptionAudio(
  audioUrl: string,
  songId: string,
): Promise<{ buffer: Buffer; filename: string; mimeType: "audio/mpeg" }>;
```

FFmpeg args:

```ts
await runFfmpeg([
  "-i", audioUrl, "-vn", "-ac", "1", "-ar", "44100",
  "-c:a", "libmp3lame", "-b:a", "96k", "-y", tempPath,
]);
```

Read the temp MP3, delete it in `finally`, and reject output above `24 * 1024 * 1024` bytes with `Transcription audio exceeds the provider file limit after compression.`

- [ ] **Step 4: Run GREEN**

Run: `pnpm exec vitest run apps/api/src/transcriptionAudio.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/transcriptionAudio.ts apps/api/src/transcriptionAudio.test.ts
git commit -m "feat: prepare trusted transcription audio"
```

---

### Task 4: Implement dual-pass transcription and official lyric alignment

**Files:**
- Create: `apps/api/src/lyricAlignment.ts`
- Create: `apps/api/src/lyricAlignment.test.ts`
- Create: `apps/api/src/openaiTranscription.ts`
- Create: `apps/api/src/openaiTranscription.test.ts`

**Interfaces:**
- Produces `TranscriptionProvider` and `OpenAITranscriptionProvider`.
- Produces `reconcileAccurateTextWithTiming(...)`.
- Produces `alignOfficialLyrics(draft, officialText)`.

- [ ] **Step 1: Write failing reconciliation tests**

```ts
it("uses preferred wording with monotonic timing", () => {
  const doc = reconcileAccurateTextWithTiming(
    "I know where I'm going",
    [
      { text: "I", start: 1.0, end: 1.2 }, { text: "no", start: 1.2, end: 1.5 },
      { text: "where", start: 1.5, end: 1.9 }, { text: "im", start: 1.9, end: 2.1 },
      { text: "going", start: 2.1, end: 2.6 },
    ],
    [{ text: "I no where im going", start: 1.0, end: 2.6 }],
  );
  expect(doc.rawText).toBe("I know where I'm going");
  expect(doc.words?.[0]?.start).toBe(1.0);
  expect(doc.words?.at(-1)?.end).toBe(2.6);
  expect(doc.segments[0]?.text).toContain("know");
});

it("aligns official lines to the timed draft", () => {
  const aligned = alignOfficialLyrics(timedDraft, "I know where I'm going\nI won't turn around");
  expect(aligned.source).toBe("hybrid");
  expect(aligned.segments).toHaveLength(2);
  expect(aligned.segments[0]!.end).toBeLessThanOrEqual(aligned.segments[1]!.start);
  expect(aligned.segments.every((s) => s.source === "official-aligned")).toBe(true);
});
```

Also test one fully unmatched official line between two matched lines and assert its timing is interpolated between neighbors.

- [ ] **Step 2: Write failing provider tests**

Mock global `fetch`. Assert two multipart requests are made:
- wording: `model=gpt-transcribe`,
- timing: `model=whisper-1`, `response_format=verbose_json`, with both `timestamp_granularities[]=word` and `timestamp_granularities[]=segment`.

Mock wording response `{ "text": "I know where I'm going", "languages": [{ "code": "en" }] }` and timing response with `words`/`segments`; assert returned document has `source: "transcription"`, language `en`, words, and segments.

- [ ] **Step 3: Run RED**

Run: `pnpm exec vitest run apps/api/src/lyricAlignment.test.ts apps/api/src/openaiTranscription.test.ts`

Expected: FAIL.

- [ ] **Step 4: Implement deterministic alignment**

Export:

```ts
export type ProviderTimedWord = { text: string; start: number; end: number };
export type ProviderTimedSegment = { text: string; start: number; end: number };

export function reconcileAccurateTextWithTiming(
  accurateText: string,
  timedWords: ProviderTimedWord[],
  timedSegments: ProviderTimedSegment[],
): LyricDocument;

export function alignOfficialLyrics(draft: LyricDocument, officialText: string): LyricDocument;
```

Use normalized lowercase alphanumeric/apostrophe tokens and monotonic dynamic-programming edit alignment. Matched/substituted preferred tokens inherit Whisper time. Unmatched preferred tokens interpolate between nearest timed neighbors. Official lyrics are split into non-empty lines; each line receives first/last matched word time, while fully unmatched lines interpolate between adjacent matched line ranges weighted by token count. Enforce non-overlap and monotonic time.

For official alignment with no timed draft words, throw `Official lyrics need timed transcription before automatic alignment.` Do not invent timestamps.

- [ ] **Step 5: Implement the provider adapter with Node 22 `fetch`/`FormData`/`Blob`**

```ts
export interface TranscriptionProvider {
  transcribe(input: { buffer: Buffer; filename: string; mimeType: string }): Promise<LyricDocument>;
}
```

`OpenAITranscriptionProvider.transcribe` creates a fresh `FormData` for each pass and runs them with `Promise.all`. Both use `Authorization: Bearer ${config.OPENAI_API_KEY}`. Provider errors include status + safe API message only.

- [ ] **Step 6: Run GREEN**

Run: `pnpm exec vitest run apps/api/src/lyricAlignment.test.ts apps/api/src/openaiTranscription.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lyricAlignment.ts apps/api/src/lyricAlignment.test.ts apps/api/src/openaiTranscription.ts apps/api/src/openaiTranscription.test.ts
git commit -m "feat: transcribe and align professional lyrics"
```

---

### Task 5: Implement validated Song Understanding

**Files:**
- Create: `apps/api/src/songUnderstanding.ts`
- Create: `apps/api/src/songUnderstanding.test.ts`

**Interfaces:**
- Produces `generateSongUnderstanding(request): Promise<SongUnderstanding>`.

- [ ] **Step 1: Write failing semantic-gate tests**

Test:
- unapproved vocal lyrics reject before `fetch`,
- approved instrumental document is accepted,
- structured `output_text` JSON is parsed through `SongUnderstanding.parse`,
- missing/refusal output throws a clear error,
- input with generic `section 1` cannot yield a high-confidence verse label unless lyrics support it; the test inspects the exact system prompt sent to the provider and asserts it includes the no-fake-label rule.

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run apps/api/src/songUnderstanding.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement strict Responses API structured output**

Use:

```ts
const body = {
  model: config.SONG_UNDERSTANDING_MODEL,
  input: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify({ lyrics: request.lyrics, analysis: request.analysis, vision: request.vision }) },
  ],
  text: {
    format: {
      type: "json_schema",
      name: "song_understanding",
      strict: true,
      schema: SONG_UNDERSTANDING_JSON_SCHEMA,
    },
  },
};
```

`SYSTEM_PROMPT` must state:
- lyric-specific claims require supplied lyric evidence,
- BPM/energy affects pacing/intensity only,
- generic analyzer section names are not verse/chorus evidence,
- distinguish literal imagery from interpretation,
- return explicit uncertainty,
- key lyric moments must use supplied lyric text and timing,
- instrumental interpretation is music + user vision and must use `basis="instrumental+vision"`.

Extract the first Responses item with content `{ type: "output_text", text: string }`, parse JSON, validate with shared `SongUnderstanding` Zod schema, and return it with no `approvedAt`.

- [ ] **Step 4: Run GREEN**

Run: `pnpm exec vitest run apps/api/src/songUnderstanding.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/songUnderstanding.ts apps/api/src/songUnderstanding.test.ts
git commit -m "feat: generate validated song understanding"
```

---

### Task 6: Add dependency-injected Phase A API routes

**Files:**
- Create: `apps/api/src/directorPhaseARoutes.ts`
- Create: `apps/api/src/directorPhaseARoutes.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- `POST /api/director/transcribe`
- `POST /api/director/align-lyrics`
- `POST /api/director/understand`

- [ ] **Step 1: Write failing route tests**

Define injected dependencies including provider readiness:

```ts
export type DirectorPhaseADeps = {
  openAiConfigured: boolean;
  prepareAudio: typeof prepareTranscriptionAudio;
  transcriptionProvider: Pick<TranscriptionProvider, "transcribe">;
  alignOfficialLyrics: typeof alignOfficialLyrics;
  generateUnderstanding: typeof generateSongUnderstanding;
};
```

Using `Fastify()` + `register`, assert:
- `openAiConfigured:false` returns 503 for transcribe and understand,
- alignment still works without OpenAI when a timed draft exists,
- invalid request bodies return 400 through Zod,
- unapproved lyrics return 400 on understand,
- success returns valid shared schemas.

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run apps/api/src/directorPhaseARoutes.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the plugin**

```ts
export async function directorPhaseARoutes(app: FastifyInstance, deps: DirectorPhaseADeps) {
  app.post("/api/director/transcribe", { config: { rateLimit: { max: 4, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!deps.openAiConfigured) {
      return reply.code(503).send({ error: "Automatic lyric transcription is not configured. Official lyrics can still be saved for later alignment." });
    }
    const input = TranscribeSongRequest.parse(req.body);
    const audio = await deps.prepareAudio(input.audioUrl, input.songId);
    return reply.send(await deps.transcriptionProvider.transcribe(audio));
  });

  app.post("/api/director/align-lyrics", async (req, reply) => {
    const input = AlignOfficialLyricsRequest.parse(req.body);
    return reply.send(deps.alignOfficialLyrics(input.draft, input.officialText));
  });

  app.post("/api/director/understand", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!deps.openAiConfigured) return reply.code(503).send({ error: "Song Understanding is not configured." });
    const input = SongUnderstandingRequest.parse(req.body);
    if (!input.lyrics.approvedAt) return reply.code(400).send({ error: "Approve lyrics before Song Understanding." });
    return reply.send(await deps.generateUnderstanding(input));
  });
}
```

Register in `server.ts` after middleware:

```ts
await app.register(directorPhaseARoutes, {
  openAiConfigured: Boolean(config.OPENAI_API_KEY),
  prepareAudio: prepareTranscriptionAudio,
  transcriptionProvider: new OpenAITranscriptionProvider(),
  alignOfficialLyrics,
  generateUnderstanding: generateSongUnderstanding,
});
```

If Fastify’s plugin-options typing does not match this direct signature, wrap with an async closure that calls `directorPhaseARoutes(instance, deps)`; keep the dependency object identical.

- [ ] **Step 4: Run GREEN and API typecheck**

```bash
pnpm exec vitest run apps/api/src/directorPhaseARoutes.test.ts
pnpm --filter @mvs/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/directorPhaseARoutes.ts apps/api/src/directorPhaseARoutes.test.ts apps/api/src/server.ts
git commit -m "feat: expose professional Director phase A APIs"
```

---

### Task 7: Persist lyrics/understanding and add browser clients

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/store.ts`
- Modify: `apps/web/src/lib/store.test.ts`

**Interfaces:**
- API: `transcribeSong`, `alignOfficialLyricsApi`, `requestSongUnderstanding`.
- Store: `lyricDocument`, `songUnderstanding`, `setLyricDocument`, `updateLyricSegment`, `approveLyrics`, `markInstrumental`, `setSongUnderstanding`, `updateSongUnderstanding`, `approveSongUnderstanding`.

- [ ] **Step 1: Write failing store tests**

Cover:
- new song clears previous lyrics/understanding,
- storing new lyrics clears Song Understanding and active Director approval,
- vocal `approveLyrics` requires at least one non-empty timed segment,
- explicit `markInstrumental` creates an approved instrumental document,
- lyric edits clear lyric approval + understanding,
- understanding edits clear understanding approval,
- snapshots persist/restore both objects,
- restored `directorStage:"clips"` normalizes to runtime `"takes"` while the historical plan remains legacy.

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run apps/web/src/lib/store.test.ts`

Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement complete browser API functions**

Add shared imports, then:

```ts
export async function transcribeSong(req: TranscribeSongRequest): Promise<LyricDocument> {
  return jsonOrThrow(await fetch("/api/director/transcribe", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req),
  }));
}

export async function alignOfficialLyricsApi(req: AlignOfficialLyricsRequest): Promise<LyricDocument> {
  return jsonOrThrow(await fetch("/api/director/align-lyrics", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req),
  }));
}

export async function requestSongUnderstanding(req: SongUnderstandingRequest): Promise<SongUnderstanding> {
  return jsonOrThrow(await fetch("/api/director/understand", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req),
  }));
}
```

- [ ] **Step 4: Implement store state and invalidation**

Add `lyricDocument: LyricDocument | null` and `songUnderstanding: SongUnderstanding | null` to `State`, `emptyState`, snapshots, and restore.

`approveLyrics()` succeeds only when source is instrumental or when at least one segment has non-empty text **and** `end > start`. Untimed `source:"official"` text remains saved but cannot be approved yet.

`markInstrumental()` sets:

```ts
{ source: "instrumental", rawText: "", segments: [], approvedAt: Date.now() }
```

Any lyric content change clears `songUnderstanding`, `directorPlan.approvedAt`, image/video approvals, and `directorFinalUrl` without deleting existing generated URLs. Any Song Understanding edit clears its `approvedAt` and downstream Director approval.

Restore migration:

```ts
const restoredStage: DirectorStage = s.directorStage === "clips" ? "takes" : (s.directorStage ?? "song");
```

- [ ] **Step 5: Run GREEN**

```bash
pnpm exec vitest run apps/web/src/lib/store.test.ts
pnpm --filter @mvs/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/store.ts apps/web/src/lib/store.test.ts
git commit -m "feat: persist professional song understanding state"
```

---

### Task 8: Block heuristic plans from Professional Director generation

**Files:**
- Modify: `apps/web/src/lib/director.ts`
- Modify: `apps/web/src/lib/directorActions.ts`
- Create: `apps/web/src/lib/professionalDirectorGate.test.ts`

**Interfaces:**
- Existing `createDirectorPlan` returns `planningBasis:"legacy-audio-heuristic"`.
- Director-owned generation requires `planningBasis:"professional-treatment"`.

- [ ] **Step 1: Write failing safety tests**

```ts
it("marks the existing planner as legacy", () => {
  expect(createDirectorPlan(analysis, "night city", {}).planningBasis).toBe("legacy-audio-heuristic");
});

it("rejects storyboard generation from an approved legacy plan", async () => {
  useStore.setState({ directorPlan: legacyApprovedPlan, productionBible: { negativePrompt: "watermark" } } as never);
  await expect(generateStoryboardImage("shot-1")).rejects.toThrow(/Legacy Director plan/);
});
```

Also assert Director video enqueue and final render reject the same legacy plan.

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run apps/web/src/lib/professionalDirectorGate.test.ts`

Expected: FAIL.

- [ ] **Step 3: Stamp the planner and centralize the guard**

In `createDirectorPlan` add:

```ts
planningBasis: "legacy-audio-heuristic",
```

In `directorActions.ts` add:

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

Call it in Director storyboard-image generation, batch storyboard generation, Director video enqueue/regeneration, and Director final render. Do not put the guard in generic Advanced Editor Agnes functions.

- [ ] **Step 4: Run GREEN**

Run: `pnpm exec vitest run apps/web/src/lib/professionalDirectorGate.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/director.ts apps/web/src/lib/directorActions.ts apps/web/src/lib/professionalDirectorGate.test.ts
git commit -m "fix: retire heuristic Director from professional generation"
```

---

### Task 9: Replace Song → Plan with Song → Lyrics → Understanding UI

**Files:**
- Modify: `apps/web/src/components/DirectorWorkspace.tsx`
- Modify: `apps/web/src/styles/director.css`
- Create: `apps/web/src/components/DirectorPhaseA.contract.test.ts`

**Interfaces:**
- Uses Task 7 store/API interfaces.
- Produces explicit Lyrics and Understanding approval screens.

- [ ] **Step 1: Write failing UI contract tests**

```ts
expect(source).toContain("2. Lyrics");
expect(source).toContain("3. Understanding");
expect(source).toContain("Verify the lyrics");
expect(source).toContain("Paste official lyrics");
expect(source).toContain("Save Official Lyrics");
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

Expected: FAIL.

- [ ] **Step 3: Change stage navigation**

Use:

```ts
const STEP_LABELS = [
  "1. Song", "2. Lyrics", "3. Understanding", "4. Treatment", "5. Plan",
  "6. Images", "7. Takes", "8. Edit", "9. Final",
] as const;
```

The stepper is horizontally scrollable. Phase A unlocks Song, Lyrics, and Understanding only. Treatment remains locked even after understanding approval because Phase B has not created a Professional Treatment object yet.

- [ ] **Step 4: Auto-transcribe after successful song upload without making upload success depend on transcription**

Sequence in `handleSong`:
1. `uploadSong(file)`,
2. `loadSong(...)`,
3. `setDirectorStage("lyrics")`,
4. call `transcribeSong(...)` in its own try/catch,
5. on success `setLyricDocument(doc)`,
6. on failure keep song loaded, show the actual transcription error, and remain on Lyrics.

- [ ] **Step 5: Implement `LyricsStep` with a real failure fallback**

Display timed transcript rows with editable segment text.

Always display an official-lyrics textarea. `Save Official Lyrics` stores:

```ts
{ source: "official", rawText: officialText, segments: [], approvedAt: undefined }
```

when no timed transcript exists, so the user’s official lyrics are not lost. Show `Timing needed before approval` and keep `Approve Lyrics` disabled until a timed draft exists.

When timed draft words exist, `Align Official Lyrics` calls `alignOfficialLyricsApi({ draft, officialText })` and stores the returned hybrid document.

Controls:
- Retry Transcription
- Save Official Lyrics
- Align Official Lyrics
- Mark as instrumental
- Approve Lyrics
- Analyze Song Meaning

`Analyze Song Meaning` is enabled only after lyric approval and calls `requestSongUnderstanding({ lyrics, analysis, vision })`; store result and advance to Understanding.

- [ ] **Step 6: Implement `UnderstandingStep`**

Show editable:
- Theme
- Emotional Arc
- Key Lyrics with timestamps/meaning
- Section Map with confidence
- Narrative Perspective / Characters
- Literal Imagery
- Symbolic Imagery
- Visual Motifs
- Performance Opportunities
- Tension / Release
- Uncertainties

Buttons: `Re-analyze` and `Approve Song Understanding`.

After approval display exactly:

`Song Understanding approved. BeatSync now has a verified semantic foundation. Professional Treatment is the next stage; the old BPM/energy heuristic planner is disabled.`

Keep `Advanced Editor` available in the header.

- [ ] **Step 7: Add Phase A CSS**

Add `.director-lyrics-grid`, `.director-lyric-row`, `.director-official-lyrics`, `.director-understanding-grid`, `.director-confidence`, `.director-stage-locked`; add horizontal overflow to the stepper. Reuse existing CSS variables and do not introduce a new color system.

- [ ] **Step 8: Run GREEN and web typecheck**

```bash
pnpm exec vitest run apps/web/src/components/DirectorPhaseA.contract.test.ts
pnpm --filter @mvs/web typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/DirectorWorkspace.tsx apps/web/src/styles/director.css apps/web/src/components/DirectorPhaseA.contract.test.ts
git commit -m "feat: add professional lyrics and understanding workflow"
```

---

### Task 10: Verify Phase A end-to-end before any Render deployment

**Files:**
- No planned production-file changes; fix only defects proven by these checks.

**Interfaces:**
- Verifies all Phase A contracts and existing EZAv2 regressions.

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

- [ ] **Step 2: Run existing repository tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 3: Run strict typechecks and production build**

```bash
pnpm typecheck
pnpm build
```

Expected: PASS with no TypeScript errors and successful web/API builds.

- [ ] **Step 4: Run existing Python audio regression**

```bash
cd audio_analysis
PYTHONPATH=. python3 -m unittest test_audio_analysis -v
```

Expected: PASS.

- [ ] **Step 5: Verify the browser cannot read the OpenAI key**

```bash
cd ..
if grep -R -E "process\.env\.OPENAI_API_KEY|import\.meta\.env.*OPENAI_API_KEY" apps/web packages/shared; then
  echo "OPENAI_API_KEY leaked into client-readable code" >&2
  exit 1
fi
```

Expected: exit 0.

- [ ] **Step 6: Re-run the legacy generation guard after all integration changes**

Run: `pnpm exec vitest run apps/web/src/lib/professionalDirectorGate.test.ts`

Expected: PASS.

- [ ] **Step 7: Record verification evidence in the implementation session**

Run:

```bash
git status --short
git log --oneline -10
```

Expected: clean working tree after task commits. If a test-proven defect required a fix during verification, commit the exact already-modified tracked files with:

```bash
git add -u
git commit -m "fix: close Professional Director Phase A regression"
```

Do not create a commit when `git status --short` is empty.

---

## Acceptance Checklist

Phase A is complete only when:

- Song upload/librosa analysis still works.
- The main Director no longer jumps from song upload directly to a generated plan.
- Automatic transcription produces a timed draft using preferred wording + timestamp alignment.
- Auto-transcription failure keeps the song loaded.
- Official lyrics can always be saved; they cannot be falsely approved as timed when timing is unavailable.
- Official lyrics align to transcription timing when timed words exist.
- Timed segments can be manually corrected.
- Instrumental Mode requires explicit user action.
- Vocal lyrics require approval before Song Understanding.
- Song Understanding is structured, editable, confidence/uncertainty-aware, and separately approved.
- Lyrics or understanding edits invalidate downstream approvals.
- Existing heuristic plans are marked `legacy-audio-heuristic`.
- Legacy plans cannot generate Professional Director storyboard images, videos, or final renders.
- Advanced Editor remains usable for manual work.
- Historical `clips` snapshots remain parseable/migratable.
- `OPENAI_API_KEY` remains server-only.
- All targeted tests, existing tests, typechecks, build, and Python audio regression pass before deployment.

## Provider Facts Used by This Plan

Verified 2026-08-27 against current OpenAI documentation: `gpt-transcribe` is the current general file-transcription path; word/segment timestamp granularities are supported on `whisper-1`; Responses API Structured Outputs can enforce a strict JSON schema. The Phase A adapter intentionally combines these capabilities rather than treating either transcript wording or timing as unquestioned truth.
