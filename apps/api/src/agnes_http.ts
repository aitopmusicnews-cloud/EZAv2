import { AGNES_IMAGE_MODEL } from "@mvs/shared";
import {
  AGNES_CREATE_URL,
  AGNES_IMAGE_CREATE_URL,
  AGNES_MODEL,
  isAgnesWaitStatus,
  parseAgnesCreateIds,
  parseAgnesImageResult,
  preferredAgnesResultUrl,
  validCompletedMetadataUrl,
  type AgnesCreateIds,
  type AgnesImageResult,
} from "./agnes_core.js";

const REQUEST_TIMEOUT_MS = 30_000;
const VIDEO_CREATE_TIMEOUT_MS = 120_000;
const IMAGE_REQUEST_TIMEOUT_MS = 60_000;
const TRANSIENT_AGNES_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 522, 524]);
const RETRY_DELAYS_MS = [500, 1000, 2000] as const;

type FetchLike = typeof fetch;
type SleepLike = (ms: number) => Promise<void>;
const defaultSleep: SleepLike = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

type AgnesResult =
  | { kind: "waiting"; status: "pending" | "queued" | "in_progress" }
  | { kind: "completed"; url: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeCompletedDiagnostics(endpointType: "preferred" | "legacy", payload: Record<string, unknown>) {
  const metadata = isRecord(payload.metadata) ? payload.metadata : null;
  console.warn("Agnes completed result is missing a valid metadata.url", {
    endpointType,
    status: typeof payload.status === "string" ? payload.status : "missing",
    hasMetadata: metadata !== null,
    topLevelKeys: Object.keys(payload),
    metadataKeys: metadata ? Object.keys(metadata) : [],
  });
}

function providerMessage(payload: Record<string, unknown>): string | null {
  const nested = isRecord(payload.error) && typeof payload.error.message === "string"
    ? payload.error.message
    : null;
  const direct = typeof payload.message === "string"
    ? payload.message
    : typeof payload.error === "string"
      ? payload.error
      : null;
  const value = (nested ?? direct)?.trim();
  return value ? value.slice(0, 300) : null;
}

async function readJson(response: Response, context: string): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Agnes returned a malformed ${context} response.`);
  }
  if (!isRecord(payload)) throw new Error(`Agnes returned a malformed ${context} response.`);
  if (!response.ok) {
    const detail = providerMessage(payload);
    throw new Error(
      `Agnes ${context} request failed with status ${response.status}${detail ? `: ${detail}` : "."}`,
    );
  }
  return payload;
}

async function fetchAgnesWithRetry(
  url: string,
  init: Omit<RequestInit, "signal">,
  fetchImpl: FetchLike,
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
    const header = response.headers.get("retry-after")?.trim();
    const seconds = header ? Number(header) : NaN;
    const date = header && !Number.isFinite(seconds) ? Date.parse(header) : NaN;
    const requestedDelay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000
      : Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
    // Provider 503 "no available channel" indicates capacity exhaustion, not a bad prompt.
    // Space out attempts instead of hammering the distributor every 0.5–2 seconds.
    const capacityDelayMs = [30_000, 60_000, 90_000][attempt]!;
    const delayMs = Math.max(
      requestedDelay,
      response.status === 429 ? 61_000 : response.status === 503 && url === AGNES_CREATE_URL
        ? capacityDelayMs
        : RETRY_DELAYS_MS[attempt]!,
    );
    await response.body?.cancel();
    await sleepImpl(delayMs);
  }
  throw new Error("unreachable");
}

export async function createAgnesVideo(
  input: {
    prompt: string;
    negativePrompt?: string;
    imageUrl?: string;
    keyframeUrls?: string[];
    width: number;
    height: number;
    numFrames: number;
    seconds?: number;
    aspectRatio?: string;
  },
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  sleepImpl: SleepLike = defaultSleep,
): Promise<AgnesCreateIds> {
  let response: Response;
  try {
    response = await fetchAgnesWithRetry(
      AGNES_CREATE_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: AGNES_MODEL,
          prompt: input.prompt,
          prompt: [input.prompt, input.negativePrompt?.trim() ? `Avoid: ${input.negativePrompt.trim()}` : ""].filter(Boolean).join("\n"),
          mode: input.keyframeUrls?.length ? "keyframe" : input.imageUrl ? "keyframe" : "text",
          ...(input.keyframeUrls?.length
            ? { first_frame: input.keyframeUrls[0], last_frame: input.keyframeUrls[1] }
            : input.imageUrl ? { first_frame: input.imageUrl } : {}),
          seconds: String(Math.max(4, Math.min(12, Math.ceil(input.seconds ?? input.numFrames / 24)))),
          size: "1080P",
          aspect_ratio: input.aspectRatio ?? "16:9",
          n: 1,
        }),
      },
      fetchImpl,
      sleepImpl,
      VIDEO_CREATE_TIMEOUT_MS,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not start Agnes video generation: ${message}`);
  }

  const payload = await readJson(response, "create-video");
  return parseAgnesCreateIds(payload);
}

export async function createAgnesImage(
  input: { prompt: string; size: string; referenceImages?: string[] },
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  sleepImpl: SleepLike = defaultSleep,
): Promise<AgnesImageResult> {
  let response: Response;
  const refs = (input.referenceImages ?? []).map((value) => value.trim()).filter(Boolean);
  try {
    response = await fetchAgnesWithRetry(
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
          n: 1,
          size: input.size,
          ...(refs.length === 1 ? { image: refs[0] } : refs.length > 1 ? { image: refs } : {}),
        }),
      },
      fetchImpl,
      sleepImpl,
      IMAGE_REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not start Agnes image generation: ${message}`);
  }

  return parseAgnesImageResult(await readJson(response, "create-image"));
}

export async function getAgnesResultOnce(
  ids: AgnesCreateIds,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<AgnesResult> {
  let response: Response;
  try {
    response = await fetchImpl(preferredAgnesResultUrl(ids.videoId), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read Agnes video generation status: ${message}`);
  }

  if (TRANSIENT_AGNES_STATUSES.has(response.status)) {
    await response.body?.cancel();
    return { kind: "waiting", status: "in_progress" };
  }
  const payload = await readJson(response, "status");
  const status = typeof payload.status === "string" ? payload.status.toLowerCase() : "";

  if (isAgnesWaitStatus(status)) {
    return { kind: "waiting", status: status as "pending" | "queued" | "in_progress" };
  }

  if (status === "failed") {
    throw new Error(`Agnes video generation failed: ${providerMessage(payload) ?? "no video was produced"}.`);
  }

  if (status !== "completed") {
    throw new Error(`Agnes returned an unexpected video generation status: ${status || "missing"}.`);
  }

  const preferredUrl = validCompletedMetadataUrl(payload);
  if (preferredUrl) return { kind: "completed", url: preferredUrl };
  safeCompletedDiagnostics("preferred", payload);

  if (ids.taskId) {
    let legacyResponse: Response;
    try {
      legacyResponse = await fetchImpl(`${AGNES_CREATE_URL}/${encodeURIComponent(ids.taskId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not read the completed Agnes video result: ${message}`);
    }

    const legacyPayload = await readJson(legacyResponse, "legacy result");
    const legacyUrl = validCompletedMetadataUrl(legacyPayload);
    if (legacyUrl) return { kind: "completed", url: legacyUrl };
    safeCompletedDiagnostics("legacy", legacyPayload);
  }

  throw new Error("Agnes completed without returning a valid HTTPS metadata.url.");
}
