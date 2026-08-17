import { SYNC_LIPSYNC_MODEL } from "@mvs/shared";

const SYNC_BASE_URL = "https://api.sync.so/v2";
const REQUEST_TIMEOUT_MS = 30_000;
const STATUS_RETRY_MS = [500, 1000] as const;
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

type FetchLike = typeof fetch;
type SleepLike = (ms: number) => Promise<void>;
const defaultSleep: SleepLike = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

type SyncStatusResult = {
  status: "waiting" | "completed" | "failed";
  outputUrl?: string;
  error?: string;
  progress?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function shortError(payload: Record<string, unknown>, fallback: string): string {
  const error = typeof payload.error === "string" ? payload.error.trim() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const errorCode = typeof payload.errorCode === "string" ? payload.errorCode.trim() : "";
  const main = error || message || fallback;
  return `${main}${errorCode ? ` (${errorCode})` : ""}`.slice(0, 300);
}

async function readSyncJson(response: Response, context: string): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Sync Labs returned a malformed ${context} response.`);
  }
  if (!isRecord(payload)) throw new Error(`Sync Labs returned a malformed ${context} response.`);
  if (!response.ok) {
    throw new Error(`Sync Labs ${context} failed with status ${response.status}: ${shortError(payload, "request failed")}`);
  }
  return payload;
}

export async function createSyncLipSync(
  input: { videoUrl: string; audioUrl: string },
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ id: string }> {
  let response: Response;
  try {
    response = await fetchImpl(`${SYNC_BASE_URL}/generate`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: SYNC_LIPSYNC_MODEL,
        input: [
          { type: "video", url: input.videoUrl },
          { type: "audio", url: input.audioUrl },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not start manual lip-sync: ${message}`);
  }

  const payload = await readSyncJson(response, "create request");
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) throw new Error("Sync Labs create response did not include an id.");
  return { id };
}

async function fetchSyncStatusWithRetry(
  id: string,
  apiKey: string,
  fetchImpl: FetchLike,
  sleepImpl: SleepLike,
): Promise<Response> {
  const url = `${SYNC_BASE_URL}/generate/${encodeURIComponent(id)}`;
  for (let attempt = 0; attempt <= STATUS_RETRY_MS.length; attempt += 1) {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!TRANSIENT_STATUS_CODES.has(response.status) || attempt === STATUS_RETRY_MS.length) {
      return response;
    }
    await sleepImpl(STATUS_RETRY_MS[attempt]!);
  }
  throw new Error("unreachable");
}

export async function getSyncLipSync(
  id: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  sleepImpl: SleepLike = defaultSleep,
): Promise<SyncStatusResult> {
  let response: Response;
  try {
    response = await fetchSyncStatusWithRetry(id, apiKey, fetchImpl, sleepImpl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read manual lip-sync status: ${message}`);
  }

  const payload = await readSyncJson(response, "status request");
  const providerStatus = typeof payload.status === "string" ? payload.status.toUpperCase() : "";
  const rawProgress = payload.progress_percent ?? payload.progressPercent ?? payload.progress;
  const progressNumber = Number(rawProgress);
  const progress = Number.isFinite(progressNumber) ? Math.max(0, Math.min(100, progressNumber)) : undefined;

  if (providerStatus === "COMPLETED") {
    const outputUrl = typeof payload.outputUrl === "string" ? payload.outputUrl.trim() : "";
    if (!outputUrl) throw new Error("Sync Labs completed without an output URL.");
    const parsed = new URL(outputUrl);
    if (parsed.protocol !== "https:") throw new Error("Sync Labs output URL was not HTTPS.");
    return { status: "completed", outputUrl: parsed.toString(), progress: progress ?? 100 };
  }

  if (providerStatus === "FAILED" || providerStatus === "REJECTED") {
    return {
      status: "failed",
      error: shortError(payload, `Sync Labs generation ${providerStatus.toLowerCase()}`),
      progress,
    };
  }

  return { status: "waiting", progress };
}
