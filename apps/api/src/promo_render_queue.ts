import { randomUUID } from "node:crypto";
import { renderPromo, type PromoRenderRequest } from "./promo_render.js";
import { FfmpegError } from "./ffmpeg.js";

export type PromoRenderJobState = "queued" | "running" | "succeeded" | "failed";

export interface PromoRenderJob {
  id: string;
  state: PromoRenderJobState;
  enqueuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  url: string | null;
  error: string | null;
  queuePosition: number | null;
}

interface InternalPromoJob extends PromoRenderJob {
  request: PromoRenderRequest;
}

const jobs = new Map<string, InternalPromoJob>();
const pending: string[] = [];
let workerActive = false;

function newId(): string {
  return `promo-render-${randomUUID().slice(0, 8)}`;
}

function snapshot(job: InternalPromoJob): PromoRenderJob {
  return {
    id: job.id,
    state: job.state,
    enqueuedAt: job.enqueuedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    url: job.url,
    error: job.error,
    queuePosition: job.queuePosition,
  };
}

function gcOldJobs(): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if ((job.state === "succeeded" || job.state === "failed") && (job.completedAt ?? 0) < cutoff) {
      jobs.delete(id);
    }
  }
}

export function submitPromoRender(request: PromoRenderRequest): PromoRenderJob {
  gcOldJobs();
  const id = newId();
  const job: InternalPromoJob = {
    id,
    request,
    state: "queued",
    enqueuedAt: Date.now(),
    startedAt: null,
    completedAt: null,
    url: null,
    error: null,
    queuePosition: pending.length,
  };
  jobs.set(id, job);
  pending.push(id);
  void runWorker();
  return snapshot(job);
}

export function getPromoRenderJob(id: string): PromoRenderJob | null {
  const job = jobs.get(id);
  return job ? snapshot(job) : null;
}

async function runWorker(): Promise<void> {
  if (workerActive) return;
  workerActive = true;
  try {
    while (pending.length) {
      const id = pending.shift()!;
      const job = jobs.get(id);
      if (!job) continue;
      for (let i = 0; i < pending.length; i += 1) {
        const waiting = jobs.get(pending[i]!);
        if (waiting) waiting.queuePosition = i;
      }

      job.state = "running";
      job.startedAt = Date.now();
      job.queuePosition = null;
      try {
        const result = await renderPromo(job.request);
        job.url = result.url;
        job.state = "succeeded";
      } catch (err) {
        job.error = err instanceof FfmpegError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
        job.state = "failed";
        console.error(`promo render ${id} failed:`, err);
      }
      job.completedAt = Date.now();
    }
  } finally {
    workerActive = false;
  }
}
