# Text-to-Image + Manual Music-Track Lip-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Agnes Text → Image generation and manual selected-clip lip-sync against the matching segment of the uploaded music track, while preserving the uploaded song as the final render soundtrack.

**Architecture:** Keep Agnes Video V2.0 as the video-generation provider, add Agnes Image 2.1 Flash as a synchronous image asset provider, and add Sync Labs `sync-3` behind a dedicated server-side lip-sync adapter. Text → Image is a UI-only sidebar mode rather than a new timeline clip source; manual lip-sync modifies an already-ready clip, stores provider task metadata separately from Agnes generation metadata, and reuses the existing audio slicer and clip rehosting path so output is durable on configured S3/local storage.

**Tech Stack:** TypeScript, Fastify, React, Zustand, Zod, native `fetch`, FFmpeg, existing local/S3 storage, Agnes Image 2.1 Flash, Agnes Video V2.0, Sync Labs v2 lip-sync API.

## Global Constraints

- Work on branch `feature/text-to-image`; do not commit implementation directly to `main`.
- Text → Image uses `agnes-image-2.1-flash` at `POST /v1/images/generations` with the existing `AGNES_API_KEY`.
- Video generation remains `agnes-video-v2.0`; Text → Image must not become a `Clip.source` value.
- Lip-sync is **manual only**. No upload, generation, timeline, playback, or render action may auto-start lip-sync.
- Manual lip-sync uses the selected clip's current `videoUrl` and the uploaded project's `audioUrl`, sliced from the selected clip's exact `[start, end]` timeline window.
- Lip-sync provider is Sync Labs v2 with model `sync-3`, `POST https://api.sync.so/v2/generate`, and `GET https://api.sync.so/v2/generate/{id}` using server-only `SYNC_API_KEY` in the `x-api-key` header.
- Never expose `AGNES_API_KEY` or `SYNC_API_KEY` to browser code, logs, task IDs, URLs, or saved project JSON.
- Lip-sync must preserve the clip's existing source (`textToVideo`, `imageToVideo`, `keyframeToVideo`, `library`, or `upload`); store lip-sync metadata in separate optional fields.
- Final render must continue mapping the original uploaded song as the audio input. Provider audio embedded in generated/lip-synced clips is not the final soundtrack.
- Generated images and completed lip-synced clips must be rehosted through the existing storage abstraction before being treated as durable library assets.
- Keep public-media URL assumptions compatible with the current S3 deployment because Agnes and Sync Labs must fetch image/video/audio input URLs over HTTPS.
- Agnes transient HTTP failures should use bounded exponential backoff. Apply the helper to both current video-create requests and the new image-create request so the existing 503 failure is improved as part of this work.
- Do not automatically retry Sync Labs generation `POST` requests after an ambiguous network failure; a retry can create duplicate billable jobs. Polling `GET` requests may retry transient failures.
- Add no provider SDK dependency; use native `fetch` so the existing install/build footprint stays unchanged.
- Every task follows RED → GREEN → commit. Run the full test/typecheck/build gate before opening the PR.

## File Structure

**Create**
- `apps/api/src/agnes_image.ts` — image-generation orchestration and durable image save.
- `apps/api/src/sync_lipsync.ts` — pure Sync Labs create/status HTTP adapter and status normalization.
- `apps/web/src/lib/lipsync.ts` — manual lip-sync controller, stale-result protection, persistence, and resume behavior.
- `tests/agnes-image.test.ts` — pure image parser + HTTP behavior tests.
- `tests/sync-lipsync.test.ts` — Sync Labs request/status mapping tests.
- `tests/text-to-image-lipsync-ui.test.mjs` — source-level wiring/guard regression test.

**Modify**
- `packages/shared/src/index.ts` — image/lip-sync schemas and clip metadata.
- `apps/api/src/agnes_core.ts` — image endpoint/model constants and image result parser.
- `apps/api/src/agnes_http.ts` — bounded Agnes retry helper, richer safe errors, image create call.
- `apps/api/src/config.ts` — `SYNC_API_KEY` server config and offline warning.
- `apps/api/src/server.ts` — Text → Image and manual lip-sync routes; extend saved clip metadata validation.
- `apps/web/src/lib/api.ts` — image generation and lip-sync API client functions.
- `apps/web/src/components/Sidebar.tsx` — UI-only Text → Image mode, preview/actions, manual lip-sync button.
- `apps/web/src/lib/store.ts` — normalize persisted lip-sync state safely.
- `apps/web/src/routes/Editor.tsx` — resume in-flight manual lip-sync jobs on reload.
- `apps/web/src/styles/app.css` — generated-image preview/actions and lip-sync status styles.
- `render.yaml` — secret `SYNC_API_KEY` declaration.
- `RENDER_SETTINGS.md` — deployment variable documentation.
- `tests/agnes-http.test.mjs` — verify video create now retries transient 503 and preserves request body.
- `tests/final-render-policy.test.mjs` — preserve original-song audio mapping with lip-sync metadata present.

---

### Task 1: Shared contracts and clip metadata

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `tests/text-to-image-lipsync-ui.test.mjs`

**Interfaces:**
- Produces: `AGNES_IMAGE_MODEL`, `SYNC_LIPSYNC_MODEL`, `TextToImageRequest`, `LipSyncRequest`, `LipSyncStatus`, and optional lip-sync fields on `Clip` / `SavedClip`.
- Consumes: existing `Clip`, `SavedClip`, `Task`, `AGNES_VIDEO_MODEL` definitions.

- [ ] **Step 1: Write the failing contract/source test**

Create `tests/text-to-image-lipsync-ui.test.mjs` initially with only the shared-contract assertions:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shared = await readFile("packages/shared/src/index.ts", "utf8");
assert.match(shared, /AGNES_IMAGE_MODEL\s*=\s*"agnes-image-2\.1-flash"/);
assert.match(shared, /SYNC_LIPSYNC_MODEL\s*=\s*"sync-3"/);
assert.match(shared, /TextToImageRequest/);
assert.match(shared, /LipSyncRequest/);
assert.match(shared, /lipSyncTaskId/);
assert.match(shared, /lipSyncStatus/);
assert.match(shared, /lipSyncSourceVideoUrl/);
assert.match(shared, /lipSyncModel/);
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
pnpm exec vitest run tests/text-to-image-lipsync-ui.test.mjs
```

Expected: FAIL because the image/lip-sync constants and schemas do not exist.

- [ ] **Step 3: Add exact shared contracts without changing `Clip.source`**

Add alongside `AGNES_VIDEO_MODEL`:

```ts
export const AGNES_IMAGE_MODEL = "agnes-image-2.1-flash" as const;
export const SYNC_LIPSYNC_MODEL = "sync-3" as const;
export type ImageGenerationModel = typeof AGNES_IMAGE_MODEL;
export type LipSyncModel = typeof SYNC_LIPSYNC_MODEL;

export const TextToImageRequest = z.object({
  promptText: z.string().trim().min(1).max(4000),
  size: z.string().regex(/^\d{3,4}x\d{3,4}$/).default("1536x864"),
});
export type TextToImageRequest = z.infer<typeof TextToImageRequest>;

export const LipSyncRequest = z.object({
  videoUrl: z.string().url(),
  audioUrl: z.string().url(),
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
}).refine((value) => value.end > value.start, {
  message: "lip-sync end must be greater than start",
  path: ["end"],
});
export type LipSyncRequest = z.infer<typeof LipSyncRequest>;

export type LipSyncStatus = "idle" | "queued" | "generating" | "ready" | "failed";
```

Extend `Clip` with metadata only; **do not** add `textToImage` or `lipSync` to the source enum:

```ts
lipSyncTaskId: z.string().optional(),
lipSyncStatus: z.enum(["idle", "queued", "generating", "ready", "failed"]).optional(),
lipSyncSourceVideoUrl: z.string().optional(),
lipSyncModel: z.string().optional(),
```

Extend `SavedClip`:

```ts
lipSyncTaskId?: string | null;
lipSyncModel?: string | null;
```

- [ ] **Step 4: Run the targeted test and typecheck**

```bash
pnpm exec vitest run tests/text-to-image-lipsync-ui.test.mjs
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts tests/text-to-image-lipsync-ui.test.mjs
git commit -m "feat: add image and lip-sync contracts"
```

---

### Task 2: Agnes image result parser and bounded HTTP retry

**Files:**
- Modify: `apps/api/src/agnes_core.ts`
- Modify: `apps/api/src/agnes_http.ts`
- Create: `tests/agnes-image.test.ts`
- Modify: `tests/agnes-http.test.mjs`

**Interfaces:**
- Produces: `createAgnesImage(input, apiKey, fetchImpl?, sleepImpl?)`, returning either `{ kind: "url"; url: string }` or `{ kind: "base64"; data: string }`.
- Produces: bounded retry behavior for Agnes transient statuses.
- Consumes: `AGNES_API_KEY`, `AGNES_IMAGE_MODEL`, existing Agnes video HTTP adapter.

- [ ] **Step 1: Write failing image parser/request tests**

Create `tests/agnes-image.test.ts`:

```ts
import { createAgnesImage } from "../apps/api/src/agnes_http.js";
import { parseAgnesImageResult } from "../apps/api/src/agnes_core.js";

function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

const urlResult = parseAgnesImageResult({ data: [{ url: "https://cdn.example.com/generated.png" }] });
equal(urlResult.kind, "url", "url result kind");
if (urlResult.kind === "url") equal(urlResult.url, "https://cdn.example.com/generated.png", "url result");

const b64Result = parseAgnesImageResult({ data: [{ b64_json: "aGVsbG8=" }] });
equal(b64Result.kind, "base64", "base64 result kind");

let calls = 0;
let capturedBody = "";
const result = await createAgnesImage(
  { prompt: "cinematic singer", size: "1536x864" },
  "secret",
  async (_url, init) => {
    calls += 1;
    capturedBody = String(init?.body ?? "");
    if (calls === 1) return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 });
    return new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/image.png" }] }), { status: 200 });
  },
  async () => {},
);
equal(calls, 2, "503 retry count");
equal(result.kind, "url", "create image result");
const request = JSON.parse(capturedBody);
equal(request.model, "agnes-image-2.1-flash", "image model");
equal(request.prompt, "cinematic singer", "prompt");
equal(request.size, "1536x864", "size");
```

Append to `tests/agnes-http.test.mjs` a video retry assertion using the same mocked 503 → 200 sequence.

- [ ] **Step 2: Run tests and confirm RED**

```bash
pnpm exec vitest run tests/agnes-image.test.ts tests/agnes-http.test.mjs
```

Expected: FAIL because the parser/image call/retry helper are missing.

- [ ] **Step 3: Add image constants and parser in `agnes_core.ts`**

Add:

```ts
export const AGNES_IMAGE_CREATE_URL = "https://apihub.agnes-ai.com/v1/images/generations";
export const AGNES_IMAGE_MODEL = "agnes-image-2.1-flash";

export type AgnesImageResult =
  | { kind: "url"; url: string }
  | { kind: "base64"; data: string };

export function parseAgnesImageResult(payload: unknown): AgnesImageResult {
  if (!isRecord(payload) || !Array.isArray(payload.data) || payload.data.length === 0) {
    throw new Error("Agnes image response did not include data.");
  }
  const first = payload.data[0];
  if (!isRecord(first)) throw new Error("Agnes image response item was malformed.");
  if (typeof first.url === "string") {
    const url = new URL(first.url);
    if (url.protocol !== "https:") throw new Error("Agnes image URL was not HTTPS.");
    return { kind: "url", url: url.toString() };
  }
  if (typeof first.b64_json === "string" && first.b64_json.trim()) {
    return { kind: "base64", data: first.b64_json.trim() };
  }
  throw new Error("Agnes image response did not include url or b64_json.");
}
```

- [ ] **Step 4: Replace one-shot Agnes HTTP calls with bounded retry**

In `agnes_http.ts`, add a private retry helper with exactly four maximum attempts and backoff delays `[500, 1000, 2000]` ms. Retry only `408`, `429`, `500`, `502`, `503`, `504`, `520`, `522`, `524` responses. Respect `Retry-After` seconds when present, capped at 5 seconds.

Core shape:

```ts
const TRANSIENT_AGNES_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 522, 524]);
const RETRY_DELAYS_MS = [500, 1000, 2000];

type SleepLike = (ms: number) => Promise<void>;
const defaultSleep: SleepLike = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchAgnesWithRetry(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
  sleepImpl: SleepLike = defaultSleep,
): Promise<Response> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await fetchImpl(url, init);
    if (!TRANSIENT_AGNES_STATUSES.has(response.status) || attempt === RETRY_DELAYS_MS.length) return response;
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
      ? Math.min(5000, retryAfterSeconds * 1000)
      : RETRY_DELAYS_MS[attempt]!;
    await sleepImpl(delay);
  }
  throw new Error("unreachable");
}
```

Use it for `createAgnesVideo`. Keep GET status polling one request per existing poll cycle; do not nest four retries into every normal pending poll unless the GET itself returns a transient HTTP error.

- [ ] **Step 5: Preserve safe provider diagnostics**

Change `readJson` so a non-2xx response extracts only a short provider `error.message`, `message`, or `error` string and appends it to the error without logging the request body or API key. Cap provider text at 300 characters.

Expected error shape:

```text
Agnes create-video request failed with status 503: system busy
```

- [ ] **Step 6: Implement `createAgnesImage`**

```ts
export async function createAgnesImage(
  input: { prompt: string; size: string },
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  sleepImpl: SleepLike = defaultSleep,
): Promise<AgnesImageResult> {
  const response = await fetchAgnesWithRetry(
    AGNES_IMAGE_CREATE_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AGNES_IMAGE_MODEL,
        prompt: input.prompt,
        size: input.size,
        response_format: "url",
      }),
      signal: AbortSignal.timeout(60_000),
    },
    fetchImpl,
    sleepImpl,
  );
  return parseAgnesImageResult(await readJson(response, "create-image"));
}
```

- [ ] **Step 7: Run targeted tests and commit**

```bash
pnpm exec vitest run tests/agnes-image.test.ts tests/agnes-http.test.mjs
pnpm typecheck
git add apps/api/src/agnes_core.ts apps/api/src/agnes_http.ts tests/agnes-image.test.ts tests/agnes-http.test.mjs
git commit -m "feat: add Agnes image generation and retries"
```

---

### Task 3: Durable Text → Image API route and automatic library save

**Files:**
- Create: `apps/api/src/agnes_image.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/web/src/lib/api.ts`
- Test: `tests/text-to-image-lipsync-ui.test.mjs`

**Interfaces:**
- Produces server route: `POST /api/generate/text-to-image`.
- Produces web client: `generateTextToImage(req: TextToImageRequest): Promise<SavedImage>`.
- Consumes: `createAgnesImage`, `saveImage`, `storage.saveUpload`, `TextToImageRequest`.

- [ ] **Step 1: Extend the source test and confirm RED**

Append assertions:

```js
const server = await readFile("apps/api/src/server.ts", "utf8");
const api = await readFile("apps/web/src/lib/api.ts", "utf8");
assert.match(server, /\/api\/generate\/text-to-image/);
assert.match(api, /generateTextToImage/);
```

Run:

```bash
pnpm exec vitest run tests/text-to-image-lipsync-ui.test.mjs
```

Expected: FAIL.

- [ ] **Step 2: Create `agnes_image.ts` orchestration**

Implement:

```ts
import { randomUUID } from "node:crypto";
import { AGNES_IMAGE_MODEL, type TextToImageRequest } from "@mvs/shared";
import { config } from "./config.js";
import { createAgnesImage } from "./agnes_http.js";
import { saveImage } from "./images.js";
import { storage } from "./storage.js";

export async function generateAndSaveAgnesImage(input: TextToImageRequest) {
  if (!config.AGNES_API_KEY) throw new Error("Agnes image generation is not configured.");
  const result = await createAgnesImage(
    { prompt: input.promptText, size: input.size },
    config.AGNES_API_KEY,
  );

  let url: string;
  if (result.kind === "url") {
    url = result.url;
  } else {
    const bytes = Buffer.from(result.data, "base64");
    if (!bytes.length) throw new Error("Agnes returned an empty image.");
    const savedUpload = await storage.saveUpload(bytes, "agnes-generated.png", "image/png");
    url = savedUpload.publicUrl;
  }

  const id = `img_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  return saveImage({
    id,
    name: input.promptText.slice(0, 80),
    url,
    source: "textToImage",
    prompt: input.promptText,
    model: AGNES_IMAGE_MODEL,
  });
}
```

This deliberately calls existing `saveImage`, so provider URLs are rehosted to S3/local storage before the SavedImage metadata is returned.

- [ ] **Step 3: Add Fastify route**

Import `TextToImageRequest` and `generateAndSaveAgnesImage`, then add near the existing Agnes routes:

```ts
app.post(
  "/api/generate/text-to-image",
  { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
  async (req, reply) => {
    if (!config.AGNES_API_KEY) {
      return reply.code(503).send({ error: "Agnes image generation is not configured." });
    }
    const saved = await generateAndSaveAgnesImage(TextToImageRequest.parse(req.body));
    return reply.send(saved);
  },
);
```

- [ ] **Step 4: Add browser API function**

In `apps/web/src/lib/api.ts` import `TextToImageRequest` and add:

```ts
export async function generateTextToImage(req: TextToImageRequest): Promise<SavedImage> {
  return jsonOrThrow(await fetch("/api/generate/text-to-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}
```

- [ ] **Step 5: Run tests/typecheck and commit**

```bash
pnpm exec vitest run tests/agnes-image.test.ts tests/text-to-image-lipsync-ui.test.mjs
pnpm typecheck
git add apps/api/src/agnes_image.ts apps/api/src/server.ts apps/web/src/lib/api.ts tests/text-to-image-lipsync-ui.test.mjs
git commit -m "feat: add durable text-to-image route"
```

---

### Task 4: Text → Image sidebar mode, preview, and image-to-video handoff

**Files:**
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/styles/app.css`
- Test: `tests/text-to-image-lipsync-ui.test.mjs`

**Interfaces:**
- Consumes: `generateTextToImage`, `SavedImage`, `addLookbook`, `updateClip`, existing `enqueueGeneration` video flow.
- Produces: UI-only `textToImage` mode, saved image preview, `Add to Lookbook`, and `Use as Start Image` actions.

- [ ] **Step 1: Extend the UI source test and confirm RED**

Append:

```js
const sidebar = await readFile("apps/web/src/components/Sidebar.tsx", "utf8");
assert.match(sidebar, /Text → Image/);
assert.match(sidebar, /generateTextToImage/);
assert.match(sidebar, /Add to Lookbook/);
assert.match(sidebar, /Use as Start Image/);
assert.doesNotMatch(shared, /source:\s*z\.enum\(\[[^\]]*"textToImage"/s, "Text → Image must not become a timeline clip source");
```

Run the test; expect FAIL.

- [ ] **Step 2: Add a UI-only sidebar mode**

Define:

```ts
type SidebarMode = GenerationSource | "textToImage" | "library";
```

Add `{ value: "textToImage", label: "Text → Image", desc: "Create a reusable still image with Agnes before animating it." }` to the mode options.

Keep the timeline source separate:

```ts
const clipSource: GenerationSource | "library" = /* existing normalization */;
const [mode, setMode] = useState<SidebarMode>(clipSource);
useEffect(() => setMode(clipSource), [clip.id]);
```

When a user selects `textToImage`, update only local `mode`; do not call `updateClip(...source...)`.

- [ ] **Step 3: Add image-generation local state**

```ts
const [generatedImage, setGeneratedImage] = useState<SavedImage | null>(null);
const [imageGenerating, setImageGenerating] = useState(false);
const imagePrompt = clip.imagePrompt ?? "";
```

When `mode === "textToImage"`, render:
- textarea bound to `clip.imagePrompt`;
- preset size select with `1536x864` (landscape/default), `1024x1024` (square), `864x1536` (portrait), `1024x768`, `768x1024`;
- `Generate Image with Agnes` button;
- preview when `generatedImage` exists.

- [ ] **Step 4: Implement generation and explicit handoff actions**

Generation:

```ts
const onGenerateImage = async () => {
  const promptText = (clip.imagePrompt ?? "").trim();
  if (!promptText) return toast.warning("Describe the image before generating");
  setImageGenerating(true);
  try {
    const saved = await generateTextToImage({ promptText, size: imageSize });
    setGeneratedImage(saved);
    toast.success("Image generated and saved to Library → Images");
  } catch (error) {
    toast.error(`Image generation failed: ${getErrorMessage(error)}`);
  } finally {
    setImageGenerating(false);
  }
};
```

`Add to Lookbook` calls `addLookbook(generatedImage.url)` only.

`Use as Start Image` performs:

```ts
addLookbook(generatedImage.url);
updateClip(clip.id, {
  source: "imageToVideo",
  archetypeUrl: generatedImage.url,
  model: AGNES_VIDEO_MODEL,
  lastError: undefined,
});
setMode("imageToVideo");
toast.success("Image set as the selected clip's first-frame reference");
```

Do **not** automatically start video generation; the Image → Video motion prompt remains an explicit next action.

- [ ] **Step 5: Add minimal CSS**

Add classes such as `.generated-image-card`, `.generated-image-preview`, `.generated-image-actions`, and reuse existing `.btn`/`.option-group` styles. Keep the preview responsive with `aspect-ratio` and `object-fit: cover`.

- [ ] **Step 6: Run targeted tests and commit**

```bash
pnpm exec vitest run tests/text-to-image-lipsync-ui.test.mjs
pnpm typecheck
pnpm --filter @mvs/web build
git add apps/web/src/components/Sidebar.tsx apps/web/src/styles/app.css tests/text-to-image-lipsync-ui.test.mjs
git commit -m "feat: add text-to-image sidebar workflow"
```

---

### Task 5: Sync Labs server adapter and deployment secret

**Files:**
- Create: `apps/api/src/sync_lipsync.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `render.yaml`
- Modify: `RENDER_SETTINGS.md`
- Create: `tests/sync-lipsync.test.ts`

**Interfaces:**
- Produces: `createSyncLipSync({ videoUrl, audioUrl }, apiKey, fetchImpl?) -> { id }`.
- Produces: `getSyncLipSync(id, apiKey, fetchImpl?) -> { status, outputUrl, error, progress }`.
- Consumes: `SYNC_API_KEY` and public HTTPS video/audio URLs.

- [ ] **Step 1: Write failing provider adapter tests**

Create `tests/sync-lipsync.test.ts`:

```ts
import { createSyncLipSync, getSyncLipSync } from "../apps/api/src/sync_lipsync.js";

function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

let init: RequestInit | undefined;
const created = await createSyncLipSync(
  { videoUrl: "https://cdn.example.com/clip.mp4", audioUrl: "https://cdn.example.com/slice.mp3" },
  "sync-secret",
  async (_url, nextInit) => {
    init = nextInit;
    return new Response(JSON.stringify({ id: "job-123", status: "PENDING", outputUrl: "" }), { status: 201 });
  },
);
equal(created.id, "job-123", "provider id");
const body = JSON.parse(String(init?.body));
equal(body.model, "sync-3", "sync model");
equal(body.input[0].type, "video", "video input");
equal(body.input[1].type, "audio", "audio input");
equal(new Headers(init?.headers).get("x-api-key"), "sync-secret", "api key header");

const completed = await getSyncLipSync("job-123", "sync-secret", async () =>
  new Response(JSON.stringify({ status: "COMPLETED", outputUrl: "https://cdn.example.com/lipsynced.mp4", progress_percent: 100 }), { status: 200 }),
);
equal(completed.status, "completed", "completed mapping");
equal(completed.outputUrl, "https://cdn.example.com/lipsynced.mp4", "output url");

const rejected = await getSyncLipSync("job-123", "sync-secret", async () =>
  new Response(JSON.stringify({ status: "REJECTED", error: "no face", errorCode: "face_not_detected" }), { status: 200 }),
);
equal(rejected.status, "failed", "rejected mapping");
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm exec vitest run tests/sync-lipsync.test.ts
```

Expected: FAIL because adapter is missing.

- [ ] **Step 3: Implement `sync_lipsync.ts` with native fetch**

Use:

```ts
const SYNC_BASE_URL = "https://api.sync.so/v2";
const SYNC_MODEL = "sync-3";
const REQUEST_TIMEOUT_MS = 30_000;
```

`createSyncLipSync` must POST exactly:

```json
{
  "model": "sync-3",
  "input": [
    { "type": "video", "url": "<videoUrl>" },
    { "type": "audio", "url": "<audioUrl>" }
  ]
}
```

Require a non-empty string `id` from a 2xx response. Do not auto-retry this POST.

`getSyncLipSync` calls:

```text
GET /v2/generate/{id}?include=progress
```

Normalize `COMPLETED` to `completed`; `FAILED` and `REJECTED` to `failed`; every other nonterminal provider status to `waiting`. Validate completed `outputUrl` as HTTPS. Extract provider `error`/`errorCode` for user-facing failure without exposing request headers.

- [ ] **Step 4: Add secret config**

In `config.ts`:

```ts
SYNC_API_KEY: optionalNonEmpty.optional(),
```

Add a warning when missing:

```ts
if (!config.SYNC_API_KEY) {
  console.warn("WARN: SYNC_API_KEY is not set. Manual lip-sync is offline.");
}
```

Do not make startup fail when the key is absent; the rest of the editor must remain usable.

- [ ] **Step 5: Add Render secret declaration and docs**

In `render.yaml`:

```yaml
      - key: SYNC_API_KEY
        sync: false
```

In `RENDER_SETTINGS.md`, document `SYNC_API_KEY` as a server-side secret used only for manual lip-sync. Do not put a real key in Git.

- [ ] **Step 6: Run test/typecheck and commit**

```bash
pnpm exec vitest run tests/sync-lipsync.test.ts
pnpm typecheck
git add apps/api/src/sync_lipsync.ts apps/api/src/config.ts render.yaml RENDER_SETTINGS.md tests/sync-lipsync.test.ts
git commit -m "feat: add Sync Labs lip-sync adapter"
```

---

### Task 6: Manual lip-sync server routes using the selected music segment

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `tests/text-to-image-lipsync-ui.test.mjs`

**Interfaces:**
- Produces: `POST /api/generate/lipsync` returning `{ id: string }`.
- Produces: `GET /api/lipsync/tasks/:id` returning the existing shared `Task` shape.
- Consumes: `LipSyncRequest`, existing `sliceAudio`, `createSyncLipSync`, `getSyncLipSync`.

- [ ] **Step 1: Add failing route/client source assertions**

Append:

```js
assert.match(server, /\/api\/generate\/lipsync/);
assert.match(server, /sliceAudio\(body\.audioUrl, body\.start, body\.end\)/);
assert.match(server, /\/api\/lipsync\/tasks\/:id/);
assert.match(api, /startLipSync/);
assert.match(api, /pollLipSyncTask/);
```

Run targeted test and confirm RED.

- [ ] **Step 2: Add manual start route**

Import `LipSyncRequest`, `createSyncLipSync`, and `getSyncLipSync`. Add:

```ts
app.post(
  "/api/generate/lipsync",
  { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
  async (req, reply) => {
    if (!config.SYNC_API_KEY) {
      return reply.code(503).send({ error: "Manual lip-sync is not configured." });
    }
    const body = LipSyncRequest.parse(req.body);
    const { url: slicedAudioUrl } = await sliceAudio(body.audioUrl, body.start, body.end);
    const task = await createSyncLipSync(
      { videoUrl: body.videoUrl, audioUrl: slicedAudioUrl },
      config.SYNC_API_KEY,
    );
    return reply.send({ id: task.id });
  },
);
```

This route is the only place that chooses the song segment. The browser sends the selected clip's exact timeline bounds; the provider never receives the entire song unless the selected clip spans it.

- [ ] **Step 3: Add status route mapped to shared `Task`**

```ts
app.get("/api/lipsync/tasks/:id", async (req, reply) => {
  if (!config.SYNC_API_KEY) return reply.code(503).send({ error: "Manual lip-sync is not configured." });
  const { id } = z.object({ id: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/) }).parse(req.params);
  const result = await getSyncLipSync(id, config.SYNC_API_KEY);
  return reply.send({
    id,
    status: result.status === "completed" ? "SUCCEEDED" : result.status === "failed" ? "FAILED" : "RUNNING",
    progress: result.progress ?? (result.status === "completed" ? 100 : undefined),
    output: result.status === "completed" && result.outputUrl ? [result.outputUrl] : null,
    error: result.error,
  });
});
```

- [ ] **Step 4: Add browser API helpers**

```ts
export async function startLipSync(req: LipSyncRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/lipsync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function getLipSyncTask(id: string): Promise<Task> {
  return jsonOrThrow(await fetch(`/api/lipsync/tasks/${encodeURIComponent(id)}`));
}

export async function pollLipSyncTask(id: string, intervalMs = 2500, timeoutMs = 20 * 60_000): Promise<Task> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await getLipSyncTask(id);
    if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("lip-sync task timed out");
}
```

- [ ] **Step 5: Extend clip-save validation for lip-sync metadata**

Add optional fields to `SaveClipBody`:

```ts
lipSyncTaskId: z.string().nullable().optional(),
lipSyncModel: z.string().nullable().optional(),
```

Pass these through `saveClip` / `SavedClip` so the Library records how a clip was processed.

- [ ] **Step 6: Run targeted tests and commit**

```bash
pnpm exec vitest run tests/sync-lipsync.test.ts tests/text-to-image-lipsync-ui.test.mjs
pnpm typecheck
git add apps/api/src/server.ts apps/web/src/lib/api.ts apps/api/src/clips.ts packages/shared/src/index.ts tests/text-to-image-lipsync-ui.test.mjs
git commit -m "feat: add manual music-segment lip-sync routes"
```

---

### Task 7: Browser lip-sync controller, stale-result safety, resume, and manual button

**Files:**
- Create: `apps/web/src/lib/lipsync.ts`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/lib/store.ts`
- Modify: `apps/web/src/routes/Editor.tsx`
- Modify: `apps/web/src/styles/app.css`
- Modify: `tests/text-to-image-lipsync-ui.test.mjs`

**Interfaces:**
- Produces: `applyLipSyncToClip(clipId)` and `resumeInflightLipSyncJobs()`.
- Consumes: store `audioUrl`, selected clip timing/video URL, `startLipSync`, `pollLipSyncTask`, `saveClipToServer`.

- [ ] **Step 1: Extend source test and confirm RED**

Append:

```js
const lipsync = await readFile("apps/web/src/lib/lipsync.ts", "utf8").catch(() => "");
const editor = await readFile("apps/web/src/routes/Editor.tsx", "utf8");
assert.match(sidebar, /Lip-sync to song segment/);
assert.match(lipsync, /applyLipSyncToClip/);
assert.match(lipsync, /pollLipSyncTask/);
assert.match(lipsync, /lipSyncSourceVideoUrl/);
assert.match(editor, /resumeInflightLipSyncJobs/);
assert.doesNotMatch(editor, /applyLipSyncToClip\(/, "Editor mount must resume only; it must not start new lip-sync work automatically");
```

- [ ] **Step 2: Implement `applyLipSyncToClip`**

Core behavior:

```ts
export async function applyLipSyncToClip(clipId: string): Promise<void> {
  const state = useStore.getState();
  const clip = state.clips.find((item) => item.id === clipId);
  if (!clip?.videoUrl) throw new Error("Selected clip has no video to lip-sync.");
  if (!state.audioUrl) throw new Error("Upload a song before using lip-sync.");
  if (clip.end <= clip.start) throw new Error("Selected clip has an invalid timeline range.");

  const sourceVideoUrl = clip.videoUrl;
  useStore.getState().updateClip(clipId, {
    lipSyncStatus: "queued",
    lipSyncSourceVideoUrl: sourceVideoUrl,
    lipSyncModel: SYNC_LIPSYNC_MODEL,
    lastError: undefined,
  });

  try {
    const started = await startLipSync({
      videoUrl: sourceVideoUrl,
      audioUrl: state.audioUrl,
      start: clip.start,
      end: clip.end,
    });
    useStore.getState().updateClip(clipId, {
      lipSyncTaskId: started.id,
      lipSyncStatus: "generating",
    });
    await finishLipSyncPoll(clipId, started.id, sourceVideoUrl);
  } catch (error) {
    const message = getErrorMessage(error);
    useStore.getState().updateClip(clipId, { lipSyncStatus: "failed", lastError: message });
    throw error;
  }
}
```

- [ ] **Step 3: Implement one completion function used by start and resume**

`finishLipSyncPoll(clipId, taskId, sourceVideoUrl)` must:
1. call `pollLipSyncTask`;
2. reject non-success/no-output;
3. re-read current clip;
4. ignore completion when `current.lipSyncTaskId !== taskId` **or** `current.videoUrl !== sourceVideoUrl`;
5. call `saveClipToServer` with the completed provider URL so existing server rehosting copies it to durable storage;
6. update the clip to the returned durable `saved.videoUrl`, `lipSyncStatus: "ready"`, `lipSyncModel: SYNC_LIPSYNC_MODEL`, and keep its original `source`.

Use the existing task URL extraction convention:

```ts
const output = final.output;
const resultUrl = typeof output === "string"
  ? output
  : Array.isArray(output)
    ? output[0]
    : output?.videoUrl ?? output?.url;
```

- [ ] **Step 4: Implement resume without automatic new generation**

```ts
let resumedLipSync = false;
export function resumeInflightLipSyncJobs(): void {
  if (resumedLipSync) return;
  resumedLipSync = true;
  for (const clip of useStore.getState().clips) {
    if (clip.lipSyncStatus === "generating" && clip.lipSyncTaskId && clip.lipSyncSourceVideoUrl) {
      void finishLipSyncPoll(clip.id, clip.lipSyncTaskId, clip.lipSyncSourceVideoUrl);
    }
  }
}
```

This only reconnects to an existing provider task. It never calls `startLipSync`.

- [ ] **Step 5: Normalize stale saved project state**

In `store.ts` snapshot restore, when a saved clip has `lipSyncStatus` of `queued` with no task ID, reset it to `failed`/idle rather than pretending it is resumable. Preserve `generating` only when both `lipSyncTaskId` and `lipSyncSourceVideoUrl` exist.

- [ ] **Step 6: Resume from Editor mount**

Change:

```ts
useEffect(() => { resumeInflightJobs(); }, []);
```

to:

```ts
useEffect(() => {
  resumeInflightJobs();
  resumeInflightLipSyncJobs();
}, []);
```

- [ ] **Step 7: Add the manual Sidebar button**

Show only for a ready selected clip with a video and loaded project audio. Button copy:

```text
Lip-sync to song segment
```

On click only:

```ts
void applyLipSyncToClip(clip.id)
  .then(() => toast.success("Lip-sync complete"))
  .catch((error) => toast.error(`Lip-sync failed: ${getErrorMessage(error)}`));
```

While `lipSyncStatus` is `queued`/`generating`, disable the button and show `Lip-syncing…`. Display the exact segment context such as `Song audio 12.50s–17.25s` so the manual behavior is obvious.

Do not call `applyLipSyncToClip` from `useEffect`, upload handlers, generation completion, timeline selection, playback, or render.

- [ ] **Step 8: Run web tests/build and commit**

```bash
pnpm exec vitest run tests/text-to-image-lipsync-ui.test.mjs
pnpm typecheck
pnpm --filter @mvs/web build
git add apps/web/src/lib/lipsync.ts apps/web/src/components/Sidebar.tsx apps/web/src/lib/store.ts apps/web/src/routes/Editor.tsx apps/web/src/styles/app.css tests/text-to-image-lipsync-ui.test.mjs
git commit -m "feat: add manual selected-clip lip-sync workflow"
```

---

### Task 8: Preserve original-song final render and complete verification

**Files:**
- Modify: `tests/final-render-policy.test.mjs`
- Review only unless test exposes a regression: `apps/api/src/render.ts`
- Review: all files changed above

**Interfaces:**
- Confirms lip-sync changes affect visual clip media only; final audio remains the uploaded song.

- [ ] **Step 1: Strengthen final-render regression before any renderer edit**

Add an assertion/comment explaining that lip-sync metadata must not alter audio mapping:

```js
assert.match(render, /"-map", `\$\{audioIdx\}:a`/, "final render must always map original uploaded song audio");
assert.doesNotMatch(render, /lipSyncTaskId|lipSyncModel/, "renderer must not switch audio behavior based on lip-sync metadata");
```

Run:

```bash
pnpm exec vitest run tests/final-render-policy.test.mjs
```

Expected: PASS without changing `render.ts`. If it fails, fix only the minimum needed to restore original-song mapping.

- [ ] **Step 2: Run focused provider/UI regression suite**

```bash
pnpm exec vitest run \
  tests/agnes-core.test.ts \
  tests/agnes-image.test.ts \
  tests/agnes-http.test.mjs \
  tests/sync-lipsync.test.ts \
  tests/text-to-image-lipsync-ui.test.mjs \
  tests/final-render-policy.test.mjs
```

Expected: all PASS.

- [ ] **Step 3: Run full repository tests**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Run compile gates**

```bash
pnpm typecheck
pnpm build
```

Expected: both PASS with no new warnings that expose provider secrets.

- [ ] **Step 5: Check accidental automatic lip-sync and secret leakage**

Run:

```bash
git grep -n "applyLipSyncToClip" -- apps/web/src
git grep -n "SYNC_API_KEY" -- apps/web || true
git grep -n "AGNES_API_KEY" -- apps/web || true
```

Expected:
- `applyLipSyncToClip` appears in the manual controller definition/import/button click path only;
- no provider API key environment names are used in browser source.

- [ ] **Step 6: Check diff scope**

```bash
git status --short
git diff --stat main...HEAD
git diff main...HEAD -- render.yaml packages/shared/src/index.ts apps/api/src apps/web/src tests RENDER_SETTINGS.md docs/superpowers/plans
```

Verify no unrelated audio-analysis/S3 changes and no provider secret values are committed.

- [ ] **Step 7: Commit final test/doc adjustments**

```bash
git add tests/final-render-policy.test.mjs
git commit -m "test: protect music-track lip-sync render policy"
```

Skip this commit only if Task 8 required no file changes after the earlier commits.

- [ ] **Step 8: Open PR**

PR title:

```text
Add Text-to-Image and manual music-track lip-sync
```

PR body must state:
- Text → Image uses Agnes Image 2.1 Flash and auto-saves to Images Library;
- manual lip-sync uses Sync Labs `sync-3` and only the selected clip's uploaded-song slice;
- lip-sync never starts automatically;
- final render still uses the original uploaded song;
- deployment requires a new server secret `SYNC_API_KEY`;
- test, typecheck, and build commands run and their results.

## Live Deployment Acceptance Check

After the PR is merged and Render has `SYNC_API_KEY` configured, perform these checks in order:

1. Upload a song and confirm timeline/audio playback still works.
2. Select a clip, choose **Text → Image**, generate a landscape image, and confirm it appears in **Library → Images** after reload.
3. Click **Use as Start Image**, enter a motion prompt, generate the video through the existing Image → Video flow, and confirm the clip becomes ready.
4. Click **Lip-sync to song segment** manually and confirm the displayed audio range matches the clip's timeline start/end.
5. Confirm the completed lip-synced clip remains playable after a page reload, proving it was rehosted to durable storage.
6. Render the project and confirm the audible soundtrack is the original uploaded song, not audio embedded in individual provider clips.
7. Repeat a Text → Video request during an Agnes 503 condition or mocked equivalent and confirm bounded retry occurs instead of immediate one-shot failure.
