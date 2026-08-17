# Text-to-Image + Manual Music-Track Lip-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Agnes Text → Image generation and manual selected-clip lip-sync against the matching segment of the uploaded music track, while preserving the uploaded song as the final render soundtrack.

**Architecture:** Keep Agnes Video V2.0 as the video-generation provider, add Agnes Image 2.1 Flash as a synchronous image asset provider, and add Sync Labs `sync-3` behind a dedicated server-side lip-sync adapter. Text → Image is a UI-only sidebar mode rather than a new timeline clip source; manual lip-sync modifies an already-ready clip, stores provider task metadata separately from Agnes generation metadata, and reuses the existing audio slicer and clip rehosting path so output is durable on configured S3/local storage.

**Tech Stack:** TypeScript, Fastify, React, Zustand, Zod, Vitest/happy-dom, native `fetch`, FFmpeg, existing local/S3 storage, Agnes Image 2.1 Flash, Agnes Video V2.0, Sync Labs v2 lip-sync API.

## Global Constraints

- Work on branch `feature/text-to-image`; do not commit implementation directly to `main`.
- Text → Image uses `agnes-image-2.1-flash` at `POST /v1/images/generations` with the existing `AGNES_API_KEY`.
- Video generation remains `agnes-video-v2.0`; Text → Image must not become a `Clip.source` value.
- Lip-sync is **manual only**. No upload, generation, timeline, playback, render, mount, or selection action may start a new lip-sync job.
- Manual lip-sync uses the selected clip's current `videoUrl` and the uploaded project's `audioUrl`, sliced from the selected clip's exact `[start, end]` timeline window.
- Lip-sync provider is Sync Labs v2 with model `sync-3`, generation endpoint `/v2/generate`, and generation-status endpoint `/v2/generate/{id}` using server-only `SYNC_API_KEY` in the `x-api-key` header.
- Never expose `AGNES_API_KEY` or `SYNC_API_KEY` to browser code, logs, task IDs, URLs, or saved project JSON.
- Lip-sync preserves the clip's existing source (`textToVideo`, `imageToVideo`, `keyframeToVideo`, `library`, or `upload`); store lip-sync metadata in separate optional fields.
- Final render continues mapping the original uploaded song as the audio input. Provider audio embedded in generated/lip-synced clips is never the final soundtrack.
- Generated images and completed lip-synced clips must pass through the existing storage/library rehosting path before being treated as durable assets.
- Keep public-media URL assumptions compatible with the current S3 deployment because Agnes and Sync Labs must fetch image/video/audio inputs over HTTPS.
- Agnes transient failures use bounded exponential backoff. Apply the helper to current video creation and new image creation so the existing one-shot 503 behavior is improved.
- Do not automatically retry Sync Labs generation `POST` requests after an ambiguous network failure; duplicate provider jobs can be billable. Sync status `GET` calls may retry transient failures.
- Add no provider SDK dependency; use native `fetch` so the install/build footprint stays unchanged.
- New automated tests live under `apps/**` or `packages/**`, because the repo's Vitest config only includes those paths. Existing root `tests/*.mjs` regressions may still be run explicitly with `node`.
- Every task follows RED → GREEN → commit. Run the full `pnpm test`, `pnpm typecheck`, and `pnpm build` gates before opening the PR.

## File Structure

**Create**
- `apps/api/src/agnes_image.ts` — image-generation orchestration and durable image save.
- `apps/api/src/agnes_image.test.ts` — image parser/request/retry tests included by normal Vitest.
- `apps/api/src/sync_lipsync.ts` — Sync Labs create/status HTTP adapter and status normalization.
- `apps/api/src/sync_lipsync.test.ts` — provider request/status/retry tests included by normal Vitest.
- `apps/web/src/lib/lipsync.ts` — manual lip-sync controller, stale-result protection, persistence, and resume behavior.
- `apps/web/src/components/Sidebar.contract.test.ts` — source-level guard test for Text → Image/manual-only lip-sync wiring.

**Modify**
- `packages/shared/src/index.ts` — image/lip-sync schemas and clip metadata.
- `apps/api/src/agnes_core.ts` — Agnes image endpoint and pure image-result parser.
- `apps/api/src/agnes_http.ts` — bounded Agnes retry helper, safe provider errors, image create call.
- `apps/api/src/config.ts` — `SYNC_API_KEY` server config and offline warning.
- `apps/api/src/server.ts` — Text → Image and manual lip-sync routes; saved clip metadata validation.
- `apps/api/src/clips.ts` — persist lip-sync metadata while preserving existing clip source/model metadata.
- `apps/web/src/lib/api.ts` — image generation and lip-sync API client functions.
- `apps/web/src/components/Sidebar.tsx` — UI-only Text → Image mode, preview/actions, manual lip-sync button.
- `apps/web/src/lib/store.ts` — safe normalization of persisted lip-sync state.
- `apps/web/src/routes/Editor.tsx` — resume existing in-flight lip-sync jobs on reload; never start new ones.
- `apps/web/src/styles/app.css` — generated-image preview/actions and lip-sync status styles.
- `render.yaml` — secret `SYNC_API_KEY` declaration.
- `RENDER_SETTINGS.md` — deployment variable documentation.
- `tests/final-render-policy.test.mjs` — protect original-song audio mapping.

---

### Task 1: Shared image/lip-sync contracts without changing timeline source semantics

**Files:**
- Modify: `packages/shared/src/index.ts`
- Create: `apps/web/src/components/Sidebar.contract.test.ts`

**Interfaces:**
- Produces: `AGNES_IMAGE_MODEL`, `SYNC_LIPSYNC_MODEL`, `TextToImageRequest`, `LipSyncRequest`, `LipSyncStatus`, and optional lip-sync fields on `Clip` / `SavedClip`.
- Consumes: existing `Clip`, `SavedClip`, `Task`, and `AGNES_VIDEO_MODEL` definitions.

- [ ] **Step 1: Write the failing contract test**

Create `apps/web/src/components/Sidebar.contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const root = new URL("../../../../", import.meta.url);

async function read(path: string) {
  return readFile(new URL(path, root), "utf8");
}

describe("text-to-image and lip-sync contracts", () => {
  it("adds provider contracts without adding image/lip-sync to Clip.source", async () => {
    const shared = await read("packages/shared/src/index.ts");
    expect(shared).toMatch(/AGNES_IMAGE_MODEL\s*=\s*"agnes-image-2\.1-flash"/);
    expect(shared).toMatch(/SYNC_LIPSYNC_MODEL\s*=\s*"sync-3"/);
    expect(shared).toMatch(/TextToImageRequest/);
    expect(shared).toMatch(/LipSyncRequest/);
    expect(shared).toMatch(/lipSyncTaskId/);
    expect(shared).toMatch(/lipSyncStatus/);
    expect(shared).toMatch(/lipSyncSourceVideoUrl/);
    expect(shared).toMatch(/lipSyncModel/);
    expect(shared).not.toMatch(/z\.enum\(\[[^\]]*"textToImage"[^\]]*\]\)/s);
    expect(shared).not.toMatch(/z\.enum\(\[[^\]]*"lipSync"[^\]]*\]\)/s);
  });
});
```

- [ ] **Step 2: Run the test and confirm RED**

```bash
pnpm exec vitest run apps/web/src/components/Sidebar.contract.test.ts
```

Expected: FAIL because the contracts do not exist yet.

- [ ] **Step 3: Add the exact shared contracts**

Add near `AGNES_VIDEO_MODEL`:

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

Extend `Clip` with metadata only:

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

Do **not** add `textToImage` or `lipSync` to `ActiveClipSource`, `Clip.source`, or `GenerationModel`.

- [ ] **Step 4: Run test + typecheck**

```bash
pnpm exec vitest run apps/web/src/components/Sidebar.contract.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts apps/web/src/components/Sidebar.contract.test.ts
git commit -m "feat: add image and lip-sync contracts"
```

---

### Task 2: Agnes image parsing plus bounded transient retry for image and video creation

**Files:**
- Modify: `apps/api/src/agnes_core.ts`
- Modify: `apps/api/src/agnes_http.ts`
- Create: `apps/api/src/agnes_image.test.ts`

**Interfaces:**
- Produces: `parseAgnesImageResult(payload)`.
- Produces: `createAgnesImage(input, apiKey, fetchImpl?, sleepImpl?)` returning `{ kind: "url"; url } | { kind: "base64"; data }`.
- Produces: bounded retry used by Agnes `createAgnesVideo` and `createAgnesImage`.

- [ ] **Step 1: Write failing parser/request/retry tests**

Create `apps/api/src/agnes_image.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { parseAgnesImageResult } from "./agnes_core.js";
import { createAgnesImage, createAgnesVideo } from "./agnes_http.js";

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("Agnes image integration", () => {
  it("parses URL and base64 image responses", () => {
    expect(parseAgnesImageResult({ data: [{ url: "https://cdn.example.com/generated.png" }] }))
      .toEqual({ kind: "url", url: "https://cdn.example.com/generated.png" });
    expect(parseAgnesImageResult({ data: [{ b64_json: "aGVsbG8=" }] }))
      .toEqual({ kind: "base64", data: "aGVsbG8=" });
  });

  it("retries an explicit 503 then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "busy" } }, 503))
      .mockResolvedValueOnce(jsonResponse({ data: [{ url: "https://cdn.example.com/image.png" }] }));

    const result = await createAgnesImage(
      { prompt: "cinematic singer", size: "1536x864" },
      "secret",
      fetchMock as typeof fetch,
      sleep,
    );

    expect(result).toEqual({ kind: "url", url: "https://cdn.example.com/image.png" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchMock.mock.calls[1]![1]!.body));
    expect(request).toMatchObject({
      model: "agnes-image-2.1-flash",
      prompt: "cinematic singer",
      size: "1536x864",
    });
  });

  it("applies the same 503 retry to video creation", async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: "busy" }, 503))
      .mockResolvedValueOnce(jsonResponse({ video_id: "video-1" }));

    await expect(createAgnesVideo(
      { prompt: "scene", width: 1152, height: 768, numFrames: 121 },
      "secret",
      fetchMock as typeof fetch,
      sleep,
    )).resolves.toEqual({ videoId: "video-1", taskId: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm exec vitest run apps/api/src/agnes_image.test.ts
```

Expected: FAIL because parser/image call/retry injection are missing.

- [ ] **Step 3: Add pure image parser in `agnes_core.ts` without duplicating the model constant**

Import the shared model constant where needed; keep only the endpoint constant in API core:

```ts
export const AGNES_IMAGE_CREATE_URL = "https://apihub.agnes-ai.com/v1/images/generations";

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

- [ ] **Step 4: Add bounded retry with a fresh timeout signal per attempt**

In `agnes_http.ts`:

```ts
const TRANSIENT_AGNES_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 522, 524]);
const RETRY_DELAYS_MS = [500, 1000, 2000] as const;
type SleepLike = (ms: number) => Promise<void>;
const defaultSleep: SleepLike = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchAgnesWithRetry(
  url: string,
  init: Omit<RequestInit, "signal">,
  fetchImpl: typeof fetch,
  sleepImpl: SleepLike,
  timeoutMs: number,
): Promise<Response> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!TRANSIENT_AGNES_STATUSES.has(response.status) || attempt === RETRY_DELAYS_MS.length) {
      return response;
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter >= 0
      ? Math.min(5000, retryAfter * 1000)
      : RETRY_DELAYS_MS[attempt]!;
    await sleepImpl(delayMs);
  }
  throw new Error("unreachable");
}
```

Change `createAgnesVideo` signature to accept `sleepImpl: SleepLike = defaultSleep`, then route its POST through this helper. Do not change the existing logical request body.

- [ ] **Step 5: Improve safe non-2xx diagnostics**

Change `readJson` so non-2xx JSON extracts only a short `error.message`, string `message`, or string `error`, capped at 300 characters. Example final message:

```text
Agnes create-video request failed with status 503: system busy
```

Never include request headers, bearer token, or full request body.

- [ ] **Step 6: Implement `createAgnesImage`**

Import `AGNES_IMAGE_MODEL` from `@mvs/shared` and `AGNES_IMAGE_CREATE_URL` / parser from `agnes_core.ts`:

```ts
export async function createAgnesImage(
  input: { prompt: string; size: string },
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
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
      }),
    },
    fetchImpl,
    sleepImpl,
    60_000,
  );
  return parseAgnesImageResult(await readJson(response, "create-image"));
}
```

The parser deliberately accepts either URL or `b64_json`, so the code does not depend on an undocumented response-format default.

- [ ] **Step 7: Run test/typecheck and commit**

```bash
pnpm exec vitest run apps/api/src/agnes_image.test.ts
pnpm typecheck
git add apps/api/src/agnes_core.ts apps/api/src/agnes_http.ts apps/api/src/agnes_image.test.ts
git commit -m "feat: add Agnes image generation and retries"
```

---

### Task 3: Durable Text → Image route and automatic Images Library save

**Files:**
- Create: `apps/api/src/agnes_image.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/components/Sidebar.contract.test.ts`

**Interfaces:**
- Produces: `POST /api/generate/text-to-image` returning a `SavedImage`.
- Produces: `generateTextToImage(req: TextToImageRequest): Promise<SavedImage>`.
- Consumes: `createAgnesImage`, existing `saveImage`, `storage.saveUpload`, `TextToImageRequest`.

- [ ] **Step 1: Add failing route/client assertions**

Extend `Sidebar.contract.test.ts`:

```ts
it("wires text-to-image through the server and browser API", async () => {
  const server = await read("apps/api/src/server.ts");
  const api = await read("apps/web/src/lib/api.ts");
  expect(server).toMatch(/\/api\/generate\/text-to-image/);
  expect(api).toMatch(/generateTextToImage/);
});
```

Run targeted test and confirm RED.

- [ ] **Step 2: Create durable image orchestration**

Create `apps/api/src/agnes_image.ts`:

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
    url = (await storage.saveUpload(bytes, "agnes-generated.png", "image/png")).publicUrl;
  }

  return saveImage({
    id: `img_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    name: input.promptText.slice(0, 80),
    url,
    source: "textToImage",
    prompt: input.promptText,
    model: AGNES_IMAGE_MODEL,
  });
}
```

Provider URL results go through existing `saveImage`, which rehosts external URLs using configured storage. Base64 results are uploaded directly, then saved as normal image metadata.

- [ ] **Step 3: Add Fastify route**

Import `TextToImageRequest` and `generateAndSaveAgnesImage`, then add near the Agnes video routes:

```ts
app.post(
  "/api/generate/text-to-image",
  { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
  async (req, reply) => {
    if (!config.AGNES_API_KEY) {
      return reply.code(503).send({ error: "Agnes image generation is not configured." });
    }
    return reply.send(await generateAndSaveAgnesImage(TextToImageRequest.parse(req.body)));
  },
);
```

- [ ] **Step 4: Add browser API function**

In `apps/web/src/lib/api.ts` import the request type and add:

```ts
export async function generateTextToImage(req: TextToImageRequest): Promise<SavedImage> {
  return jsonOrThrow(await fetch("/api/generate/text-to-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}
```

- [ ] **Step 5: Run tests/build gate and commit**

```bash
pnpm exec vitest run apps/api/src/agnes_image.test.ts apps/web/src/components/Sidebar.contract.test.ts
pnpm typecheck
pnpm --filter @mvs/api build
git add apps/api/src/agnes_image.ts apps/api/src/server.ts apps/web/src/lib/api.ts apps/web/src/components/Sidebar.contract.test.ts
git commit -m "feat: add durable text-to-image route"
```

---

### Task 4: Text → Image sidebar mode, preview, and explicit Image → Video handoff

**Files:**
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/styles/app.css`
- Modify: `apps/web/src/components/Sidebar.contract.test.ts`

**Interfaces:**
- Consumes: `generateTextToImage`, `SavedImage`, `addLookbook`, `updateClip`.
- Produces: UI-only `textToImage` mode, saved preview, `Add to Lookbook`, and `Use as Start Image` actions.

- [ ] **Step 1: Add failing UI assertions**

Extend the contract test:

```ts
it("exposes text-to-image as a UI-only mode with explicit handoff actions", async () => {
  const sidebar = await read("apps/web/src/components/Sidebar.tsx");
  expect(sidebar).toMatch(/Text → Image/);
  expect(sidebar).toMatch(/generateTextToImage/);
  expect(sidebar).toMatch(/Add to Lookbook/);
  expect(sidebar).toMatch(/Use as Start Image/);
  expect(sidebar).not.toMatch(/enqueueGeneration\([^)]*textToImage/s);
});
```

Run and confirm RED.

- [ ] **Step 2: Add hook-safe UI state before the existing conditional return**

All new hooks must be declared before `if (!clip || !analysis) return null;` so hook order never changes:

```ts
type SidebarMode = GenerationSource | "textToImage" | "library";

const [mode, setMode] = useState<SidebarMode>("textToVideo");
const [generatedImage, setGeneratedImage] = useState<SavedImage | null>(null);
const [imageGenerating, setImageGenerating] = useState(false);
const [imageSize, setImageSize] = useState("1536x864");

useEffect(() => {
  if (!clip) return;
  const next: GenerationSource | "library" =
    clip.source === "imageToVideo" || clip.source === "keyframeToVideo" || clip.source === "library"
      ? clip.source
      : "textToVideo";
  setMode(next);
  setGeneratedImage(null);
}, [clip?.id]);
```

After the null guard, derive the normal clip source separately. Do not use `mode` as `clip.source` when `mode === "textToImage"`.

- [ ] **Step 3: Add Text → Image to the mode options**

```ts
{ value: "textToImage", label: "Text → Image", desc: "Create a reusable still image with Agnes before animating it." }
```

`setMode` behavior:
- `textToImage`: local state only;
- `library`: update clip source to `library` as existing behavior requires;
- Agnes video modes: update clip source/model as existing behavior requires.

- [ ] **Step 4: Render image prompt/size/preview controls**

When `mode === "textToImage"`, show:
- textarea bound to `clip.imagePrompt`;
- preset sizes `1536x864` (landscape/default), `1024x1024` (square), `864x1536` (portrait), `1024x768`, `768x1024`;
- `Generate Image with Agnes` button;
- generated image preview.

Generation handler:

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

- [ ] **Step 5: Add explicit reusable-image actions**

`Add to Lookbook` only calls `addLookbook(generatedImage.url)`.

`Use as Start Image`:

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

Do **not** auto-call `enqueueGeneration`. The user next writes/accepts the motion prompt and presses the existing Agnes video generate button.

- [ ] **Step 6: Add minimal CSS and verify**

Add `.generated-image-card`, `.generated-image-preview`, `.generated-image-actions`; reuse existing button classes. Preview uses `width: 100%`, `aspect-ratio`, and `object-fit: cover` without adding a new design system.

Run:

```bash
pnpm exec vitest run apps/web/src/components/Sidebar.contract.test.ts
pnpm typecheck
pnpm --filter @mvs/web build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx apps/web/src/styles/app.css apps/web/src/components/Sidebar.contract.test.ts
git commit -m "feat: add text-to-image sidebar workflow"
```

---

### Task 5: Sync Labs adapter and server-only deployment secret

**Files:**
- Create: `apps/api/src/sync_lipsync.ts`
- Create: `apps/api/src/sync_lipsync.test.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `render.yaml`
- Modify: `RENDER_SETTINGS.md`

**Interfaces:**
- Produces: `createSyncLipSync({ videoUrl, audioUrl }, apiKey, fetchImpl?) -> { id }`.
- Produces: `getSyncLipSync(id, apiKey, fetchImpl?, sleepImpl?) -> { status, outputUrl, error, progress }`.

- [ ] **Step 1: Write failing provider tests**

Create `apps/api/src/sync_lipsync.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createSyncLipSync, getSyncLipSync } from "./sync_lipsync.js";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Sync Labs lip-sync adapter", () => {
  it("creates sync-3 with one video and one audio URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "job-123", status: "PENDING" }, 201));
    await expect(createSyncLipSync(
      { videoUrl: "https://cdn.example.com/clip.mp4", audioUrl: "https://cdn.example.com/slice.mp3" },
      "sync-secret",
      fetchMock as typeof fetch,
    )).resolves.toEqual({ id: "job-123" });
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init!.body));
    expect(body).toEqual({
      model: "sync-3",
      input: [
        { type: "video", url: "https://cdn.example.com/clip.mp4" },
        { type: "audio", url: "https://cdn.example.com/slice.mp3" },
      ],
    });
    expect(new Headers(init!.headers).get("x-api-key")).toBe("sync-secret");
  });

  it("maps completed and rejected states", async () => {
    await expect(getSyncLipSync("job-123", "secret", async () =>
      jsonResponse({ status: "COMPLETED", outputUrl: "https://cdn.example.com/out.mp4", progress_percent: 100 })
    )).resolves.toMatchObject({ status: "completed", outputUrl: "https://cdn.example.com/out.mp4", progress: 100 });

    await expect(getSyncLipSync("job-123", "secret", async () =>
      jsonResponse({ status: "REJECTED", error: "no face", errorCode: "face_not_detected" })
    )).resolves.toMatchObject({ status: "failed", error: expect.stringMatching(/no face/) });
  });

  it("retries transient status GET but never duplicates create POST", async () => {
    const sleep = vi.fn(async () => {});
    const statusFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: "temporary" }, 503))
      .mockResolvedValueOnce(jsonResponse({ status: "PENDING", progress_percent: 20 }));
    await getSyncLipSync("job-123", "secret", statusFetch as typeof fetch, sleep);
    expect(statusFetch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm exec vitest run apps/api/src/sync_lipsync.test.ts
```

- [ ] **Step 3: Implement raw HTTP adapter**

Create `sync_lipsync.ts` with:

```ts
const SYNC_BASE_URL = "https://api.sync.so/v2";
const SYNC_MODEL = "sync-3";
const REQUEST_TIMEOUT_MS = 30_000;
const STATUS_RETRY_MS = [500, 1000] as const;
```

`createSyncLipSync` POST body is exactly:

```json
{
  "model": "sync-3",
  "input": [
    { "type": "video", "url": "<videoUrl>" },
    { "type": "audio", "url": "<audioUrl>" }
  ]
}
```

Use `x-api-key` and JSON headers. Require a non-empty provider `id`. **Do not wrap this POST in a retry loop.**

`getSyncLipSync` calls:

```text
GET /v2/generate/{id}?include=progress
```

Use a fresh 30-second timeout per GET attempt. Retry only `429`, `500`, `502`, `503`, `504` status responses, maximum three attempts total. Normalize:
- `COMPLETED` → `completed`; require HTTPS `outputUrl`;
- `FAILED` / `REJECTED` → `failed`;
- every other provider status → `waiting`.

Return `progress_percent` as `progress` when finite. Failure text may combine short `error` and `errorCode`; never return headers or secret values.

- [ ] **Step 4: Add config and offline warning**

In `config.ts`:

```ts
SYNC_API_KEY: optionalNonEmpty.optional(),
```

After Agnes warning:

```ts
if (!config.SYNC_API_KEY) {
  console.warn("WARN: SYNC_API_KEY is not set. Manual lip-sync is offline.");
}
```

Missing Sync key must not stop the server.

- [ ] **Step 5: Add Render secret and deployment docs**

In `render.yaml`:

```yaml
      - key: SYNC_API_KEY
        sync: false
```

In `RENDER_SETTINGS.md`, document `SYNC_API_KEY` as a server-only manual lip-sync secret. Never commit a real key.

- [ ] **Step 6: Run tests/typecheck and commit**

```bash
pnpm exec vitest run apps/api/src/sync_lipsync.test.ts
pnpm typecheck
git add apps/api/src/sync_lipsync.ts apps/api/src/sync_lipsync.test.ts apps/api/src/config.ts render.yaml RENDER_SETTINGS.md
git commit -m "feat: add Sync Labs lip-sync adapter"
```

---

### Task 6: Manual lip-sync server routes using the selected timeline music slice

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/clips.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/components/Sidebar.contract.test.ts`

**Interfaces:**
- Produces: `POST /api/generate/lipsync -> { id }`.
- Produces: `GET /api/lipsync/tasks/:id -> Task`.
- Produces: `startLipSync`, `getLipSyncTask`, `pollLipSyncTask` in the browser API.
- Consumes: `LipSyncRequest`, existing `sliceAudio`, Sync adapter, existing clip saver/rehosting.

- [ ] **Step 1: Add failing route/client/manual-slice assertions**

Extend `Sidebar.contract.test.ts`:

```ts
it("routes manual lip-sync through the selected song slice", async () => {
  const server = await read("apps/api/src/server.ts");
  const api = await read("apps/web/src/lib/api.ts");
  expect(server).toMatch(/\/api\/generate\/lipsync/);
  expect(server).toMatch(/sliceAudio\(body\.audioUrl, body\.start, body\.end\)/);
  expect(server).toMatch(/\/api\/lipsync\/tasks\/:id/);
  expect(api).toMatch(/startLipSync/);
  expect(api).toMatch(/pollLipSyncTask/);
});
```

Run and confirm RED.

- [ ] **Step 2: Add manual start route**

Import `LipSyncRequest`, `createSyncLipSync`, `getSyncLipSync`. Add:

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

No other server route calls this route/function automatically.

- [ ] **Step 3: Add status route mapped to shared `Task`**

```ts
app.get("/api/lipsync/tasks/:id", async (req, reply) => {
  if (!config.SYNC_API_KEY) return reply.code(503).send({ error: "Manual lip-sync is not configured." });
  const { id } = z.object({
    id: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/),
  }).parse(req.params);
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

In `apps/web/src/lib/api.ts`:

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

- [ ] **Step 5: Persist lip-sync metadata in clip library**

Extend server `SaveClipBody`:

```ts
lipSyncTaskId: z.string().nullable().optional(),
lipSyncModel: z.string().nullable().optional(),
```

Extend `saveClip` input in `apps/api/src/clips.ts`:

```ts
lipSyncTaskId?: string | null;
lipSyncModel?: string | null;
```

Add to the saved object:

```ts
lipSyncTaskId: input.lipSyncTaskId,
lipSyncModel: input.lipSyncModel,
```

Do not change the clip `source` during save.

- [ ] **Step 6: Run tests/typecheck and commit**

```bash
pnpm exec vitest run apps/api/src/sync_lipsync.test.ts apps/web/src/components/Sidebar.contract.test.ts
pnpm typecheck
git add apps/api/src/server.ts apps/api/src/clips.ts apps/web/src/lib/api.ts apps/web/src/components/Sidebar.contract.test.ts
git commit -m "feat: add manual music-segment lip-sync routes"
```

---

### Task 7: Browser manual lip-sync controller, stale-result safety, resume, and button

**Files:**
- Create: `apps/web/src/lib/lipsync.ts`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/lib/store.ts`
- Modify: `apps/web/src/routes/Editor.tsx`
- Modify: `apps/web/src/styles/app.css`
- Modify: `apps/web/src/components/Sidebar.contract.test.ts`

**Interfaces:**
- Produces: `applyLipSyncToClip(clipId)` and `resumeInflightLipSyncJobs()`.
- Consumes: store `audioUrl`, selected clip `start/end/videoUrl`, lip-sync browser API, existing `saveClipToServer`.

- [ ] **Step 1: Add failing manual-only UI/resume assertions**

Extend the contract test:

```ts
it("starts lip-sync only from the manual button and resumes existing tasks separately", async () => {
  const sidebar = await read("apps/web/src/components/Sidebar.tsx");
  const editor = await read("apps/web/src/routes/Editor.tsx");
  const controller = await read("apps/web/src/lib/lipsync.ts").catch(() => "");
  expect(sidebar).toMatch(/Lip-sync to song segment/);
  expect(sidebar).toMatch(/applyLipSyncToClip/);
  expect(controller).toMatch(/startLipSync/);
  expect(controller).toMatch(/pollLipSyncTask/);
  expect(controller).toMatch(/lipSyncSourceVideoUrl/);
  expect(editor).toMatch(/resumeInflightLipSyncJobs/);
  expect(editor).not.toMatch(/applyLipSyncToClip\(/);
});
```

Run and confirm RED.

- [ ] **Step 2: Implement start path in `apps/web/src/lib/lipsync.ts`**

```ts
import { SYNC_LIPSYNC_MODEL, getErrorMessage, type Clip, type Task } from "@mvs/shared";
import { useStore } from "./store.js";
import { pollLipSyncTask, saveClipToServer, startLipSync } from "./api.js";

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
    useStore.getState().updateClip(clipId, {
      lipSyncStatus: "failed",
      lastError: getErrorMessage(error),
    });
    throw error;
  }
}
```

- [ ] **Step 3: Add completion helper with stale-result protection and durable save**

Use one `taskOutputUrl(task)` helper in this file, matching existing scheduler semantics. `finishLipSyncPoll(clipId, taskId, sourceVideoUrl)` must:
1. `await pollLipSyncTask(taskId)`;
2. reject failed/non-output result;
3. re-read current clip;
4. ignore completion unless `current.lipSyncTaskId === taskId` **and** `current.videoUrl === sourceVideoUrl`;
5. call `saveClipToServer` with provider output, preserving `current.source`, `current.model`, prompt, duration, section label, and adding `lipSyncTaskId` / `lipSyncModel`;
6. update `videoUrl` to the returned durable `saved.videoUrl`, `lipSyncStatus: "ready"`, `lipSyncModel: SYNC_LIPSYNC_MODEL`, and clear `lastError`.

Core durable save:

```ts
const saved = await saveClipToServer({
  id: current.id,
  name: current.prompt?.slice(0, 60) || "lip-synced clip",
  videoUrl: resultUrl,
  source: current.source,
  prompt: current.prompt ?? null,
  duration: current.end - current.start,
  sectionLabel: current.sectionLabel ?? null,
  model: current.model ?? null,
  generationTaskId: current.generationTaskId ?? null,
  lipSyncTaskId: taskId,
  lipSyncModel: SYNC_LIPSYNC_MODEL,
});
```

- [ ] **Step 4: Resume only already-started provider jobs**

Avoid a one-time global boolean; track active provider IDs so loading another project in the same browser session can still resume its tasks:

```ts
const activeResumeIds = new Set<string>();

export function resumeInflightLipSyncJobs(): void {
  for (const clip of useStore.getState().clips) {
    if (
      clip.lipSyncStatus !== "generating" ||
      !clip.lipSyncTaskId ||
      !clip.lipSyncSourceVideoUrl ||
      activeResumeIds.has(clip.lipSyncTaskId)
    ) continue;
    activeResumeIds.add(clip.lipSyncTaskId);
    void finishLipSyncPoll(clip.id, clip.lipSyncTaskId, clip.lipSyncSourceVideoUrl)
      .finally(() => activeResumeIds.delete(clip.lipSyncTaskId!));
  }
}
```

This function never calls `startLipSync`.

- [ ] **Step 5: Normalize persisted lip-sync state**

In `store.ts` snapshot restore:
- preserve `generating` only when both `lipSyncTaskId` and `lipSyncSourceVideoUrl` exist;
- convert orphaned `queued`/`generating` state to `failed` (or unset/idle) while preserving the current playable `videoUrl`;
- never clear a ready clip's video just because a lip-sync task became stale.

- [ ] **Step 6: Resume from Editor mount**

Import `resumeInflightLipSyncJobs` and change mount effect to:

```ts
useEffect(() => {
  resumeInflightJobs();
  resumeInflightLipSyncJobs();
}, []);
```

This reconnects to existing tasks only.

- [ ] **Step 7: Add the explicit manual Sidebar button**

Show for a selected clip only when:
- `clip.videoUrl` exists;
- project `audioUrl` exists;
- clip is not currently lip-syncing.

Button copy:

```text
Lip-sync to song segment
```

Display context immediately above/below it:

```text
Song audio 12.50s–17.25s
```

On click only:

```ts
void applyLipSyncToClip(clip.id)
  .then(() => toast.success("Lip-sync complete"))
  .catch((error) => toast.error(`Lip-sync failed: ${getErrorMessage(error)}`));
```

While queued/generating, show `Lip-syncing…`. Do not call `applyLipSyncToClip` from any `useEffect`, upload handler, video generation completion, clip selection handler, play handler, or render handler.

- [ ] **Step 8: Run test/typecheck/web build and commit**

```bash
pnpm exec vitest run apps/web/src/components/Sidebar.contract.test.ts
pnpm typecheck
pnpm --filter @mvs/web build
git add apps/web/src/lib/lipsync.ts apps/web/src/components/Sidebar.tsx apps/web/src/lib/store.ts apps/web/src/routes/Editor.tsx apps/web/src/styles/app.css apps/web/src/components/Sidebar.contract.test.ts
git commit -m "feat: add manual selected-clip lip-sync workflow"
```

---

### Task 8: Protect final soundtrack, run full verification, and prepare PR

**Files:**
- Modify: `tests/final-render-policy.test.mjs`
- Review only unless regression is found: `apps/api/src/render.ts`
- Review: all feature files above

**Interfaces:**
- Confirms lip-sync changes modify visual clip media only and preserve original uploaded song audio in final render.

- [ ] **Step 1: Strengthen original-song regression**

Add to `tests/final-render-policy.test.mjs`:

```js
assert.match(render, /"-map", `\$\{audioIdx\}:a`/, "final render must always map original uploaded song audio");
assert.doesNotMatch(render, /lipSyncTaskId|lipSyncModel/, "renderer must not switch audio behavior based on lip-sync metadata");
```

Run explicitly because root `tests/*.mjs` is outside the normal Vitest include:

```bash
node tests/final-render-policy.test.mjs
```

Expected: PASS without changing `render.ts`. If it fails, make only the smallest render fix required to restore original-song mapping.

- [ ] **Step 2: Run focused automated suite**

```bash
pnpm exec vitest run \
  apps/api/src/agnes_image.test.ts \
  apps/api/src/sync_lipsync.test.ts \
  apps/web/src/components/Sidebar.contract.test.ts
node tests/final-render-policy.test.mjs
```

Expected: all PASS.

- [ ] **Step 3: Run normal repository test gate**

```bash
pnpm test
```

Expected: PASS, including the new `apps/**.test.ts` tests.

- [ ] **Step 4: Run compile gates**

```bash
pnpm typecheck
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Check automatic-start and secret-leak regressions**

```bash
git grep -n "applyLipSyncToClip" -- apps/web/src
git grep -n "SYNC_API_KEY" -- apps/web || true
git grep -n "AGNES_API_KEY" -- apps/web || true
```

Expected:
- `applyLipSyncToClip` appears only in its controller definition/import/manual button path;
- no provider secret environment variable is referenced in browser source.

- [ ] **Step 6: Check diff scope**

```bash
git status --short
git diff --stat main...HEAD
git diff main...HEAD -- render.yaml packages/shared/src/index.ts apps/api/src apps/web/src tests/final-render-policy.test.mjs RENDER_SETTINGS.md docs/superpowers/plans
```

Verify no unrelated audio-analysis/S3 behavior changed and no secret values were committed.

- [ ] **Step 7: Commit final regression change if needed**

```bash
git add tests/final-render-policy.test.mjs apps/api/src/render.ts
git commit -m "test: protect music-track lip-sync render policy"
```

If `render.ts` was untouched, only stage the test file. If the test already contained the exact assertion and no file changed, skip this commit.

- [ ] **Step 8: Open PR**

PR title:

```text
Add Text-to-Image and manual music-track lip-sync
```

PR body states:
- Text → Image uses Agnes Image 2.1 Flash and auto-saves to Images Library;
- manual lip-sync uses Sync Labs `sync-3` and only the selected clip's uploaded-song slice;
- lip-sync never starts automatically;
- final render still uses the original uploaded song;
- deployment requires new server secret `SYNC_API_KEY`;
- exact `pnpm test`, `pnpm typecheck`, and `pnpm build` results.

## Live Deployment Acceptance Check

After the PR is merged and Render has `SYNC_API_KEY` configured:

1. Upload a song and confirm timeline/audio playback still works.
2. Select a clip, choose **Text → Image**, generate a landscape image, reload, and confirm it appears in **Library → Images**.
3. Click **Use as Start Image**, enter a motion prompt, generate through the existing Image → Video flow, and confirm the clip becomes ready.
4. Click **Lip-sync to song segment** manually and confirm the displayed audio range exactly matches the selected clip's timeline start/end.
5. Confirm the completed lip-synced clip remains playable after reload, proving the provider result was rehosted to durable storage.
6. Render the project and confirm the audible soundtrack is the original uploaded song, not audio embedded in provider clips.
7. Exercise an Agnes 503 condition (or the automated mock) and confirm bounded retry occurs instead of the old immediate one-shot failure.
