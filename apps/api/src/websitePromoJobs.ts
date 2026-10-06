import { randomUUID } from "node:crypto";
import type { WebsitePromoJob, WebsitePromoRequest } from "@mvs/shared";
import { startAgnesVideo, refreshAgnesJob } from "./agnesVideo.js";
import { decodeTaskId } from "./generationJobs.js";
import { synthesizePromoVoiceover } from "./azureTts.js";
import { submitPromoRender, getPromoRenderJob } from "./promo_render_queue.js";
import { storage } from "./storage.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const key = (id: string) => `website-promos/${id}.json`;
const productionDeps = {
  load: (id: string) => storage.loadJson<WebsitePromoJob>(key(id)),
  save: (job: WebsitePromoJob) => storage.saveJson(key(job.id), job),
  startVideo: startAgnesVideo,
  refreshVideo: async (id: string) => refreshAgnesJob(decodeTaskId(id).id),
  voice: synthesizePromoVoiceover,
  submitRender: submitPromoRender,
  getRender: getPromoRenderJob,
  sleep,
};
type Dependencies = typeof productionDeps;

export function promoShotPrompt(request: WebsitePromoRequest, index: number): string {
  return [
    "Produce one finished live-action commercial shot with natural subject movement and motivated camera movement, not a still-image slideshow.",
    "Consistent premium color grade and lighting across this campaign. Vary shot scale and composition between scenes. Keep important action centered for social crops.",
    "No added text, captions, titles, watermarks, fabricated logos, readable screens, certificates, or invented product interfaces. No duplicate people or extra limbs. If an exact product screen is requested but no real asset is supplied, show relevant human activity with screens out of focus instead.",
    `Campaign: ${request.draft.headline}. Narration context (do not speak or print it): ${request.draft.voiceover}`,
    `Shot ${index + 1} of ${request.draft.scenes.length}: ${request.draft.scenes[index]!.visual}`,
    "Scene descriptions are creative reference only; never add visible writing even if the description suggests it.",
  ].join("\n");
}

/** Checkpoint each expensive result. One worker at a time avoids parallel Agnes requests. */
export function createWebsitePromoService(deps: Dependencies = productionDeps) {
  const scheduled = new Set<string>();
  let tail = Promise.resolve();

  async function run(job: WebsitePromoJob) {
    try {
      if (!job.voiceoverUrl) {
        job.message = "Creating narration…"; await deps.save(job);
        const voice = await deps.voice(job.request.draft.voiceover);
        job.voiceoverUrl = voice.publicUrl;
        await deps.save(job);
      }
      const duration = job.request.duration / job.request.draft.scenes.length;
      for (let index = job.scenes.length; index < job.request.draft.scenes.length; index++) {
        job.message = `Creating video shot ${index + 1} of ${job.request.draft.scenes.length}…`;
        await deps.save(job);
        const uploaded = job.request.shots[index];
        if (uploaded) {
          job.scenes.push({ ...uploaded, duration });
          await deps.save(job);
          continue;
        }
        if (!job.taskId) {
          const task = await deps.startVideo({
            promptText: promoShotPrompt(job.request, index), duration,
            aspectRatio: job.request.aspectRatio === "16:9" ? "16:9" : "9:16",
            negativePrompt: "text, subtitles, watermark, duplicate people, extra limbs, fake interface, slideshow",
          }, "textToVideo");
          job.taskId = task.id; await deps.save(job);
        }
        const deadline = Date.now() + 20 * 60_000;
        while (true) {
          const task = await deps.refreshVideo(job.taskId);
          if (!task || task.status === "failed") {
            delete job.taskId;
            throw new Error(task?.error ?? "The saved generation task is unavailable. Retry to recreate this shot.");
          }
          if (task.status === "completed") {
            if (!task.video_url) { delete job.taskId; throw new Error("The video provider returned no clip. Retry this shot."); }
            job.scenes.push({ url: task.video_url, kind: "video", duration });
            delete job.taskId; await deps.save(job);
            break;
          }
          if (Date.now() > deadline) throw new Error("Video generation is taking longer than expected. Resume to check the existing task.");
          await deps.sleep(10_000);
        }
        // Respect the provider's request spacing, even for fast completions.
        if (index + 1 < job.request.draft.scenes.length) await deps.sleep(10_000);
      }
      job.message = "Assembling video and mixing narration…"; await deps.save(job);
      if (!job.renderId || !deps.getRender(job.renderId)) {
        const render = deps.submitRender({
          projectId: job.id, duration: job.request.duration, aspectRatio: job.request.aspectRatio,
          scenes: job.scenes.map((scene, index) => ({ ...scene, motion: "static", fit: index < job.request.shots.length ? "contain" : "cover" })),
          voiceoverUrl: job.voiceoverUrl, musicUrl: job.request.musicUrl,
          musicVolume: job.request.musicVolume, voiceoverVolume: job.request.voiceoverVolume,
          duckMusic: job.request.duckMusic, textOverlays: [], fitVoiceover: true,
        });
        job.renderId = render.id; await deps.save(job);
      }
      const deadline = Date.now() + 30 * 60_000;
      while (true) {
        const render = deps.getRender(job.renderId);
        if (!render || render.state === "failed") {
          delete job.renderId;
          throw new Error(render?.error ?? "Rendering was interrupted. Retry to assemble the saved shots.");
        }
        if (render.state === "succeeded" && render.url) {
          job.url = render.url; job.state = "succeeded"; job.message = "Your promo is ready";
          await deps.save(job); return;
        }
        if (Date.now() > deadline) throw new Error("Rendering is taking longer than expected. Resume to check the existing render.");
        await deps.sleep(3000);
      }
    } catch (error) {
      job.state = "failed";
      job.error = error instanceof Error ? error.message : "Promo generation failed.";
      job.message = "Paused — completed shots are saved";
      await deps.save(job);
    }
  }
  function schedule(id: string) {
    if (scheduled.has(id)) return;
    scheduled.add(id);
    tail = tail.then(async () => {
      const job = await deps.load(id);
      if (job?.state === "running") await run(job);
    }).catch((error) => console.error("Website promo worker failed:", error))
      .finally(() => { scheduled.delete(id); });
  }
  return {
    async start(request: WebsitePromoRequest) {
      const job: WebsitePromoJob = { id: `website-promo-${randomUUID()}`, request, scenes: [], state: "running", message: "Queued for production…" };
      await deps.save(job); schedule(job.id); return job;
    },
    async get(id: string) { return deps.load(id); },
    async resume(id: string) {
      if (scheduled.has(id)) return deps.load(id);
      const job = await deps.load(id);
      if (!job || job.state === "succeeded") return job;
      job.state = "running"; delete job.error; job.message = "Resuming saved promo…";
      await deps.save(job); schedule(id); return job;
    },
    idle: () => tail,
  };
}
export const websitePromoService = createWebsitePromoService();
