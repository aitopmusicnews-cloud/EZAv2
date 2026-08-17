import { SYNC_LIPSYNC_MODEL, getErrorMessage, type Task } from "@mvs/shared";
import { useStore } from "./store.js";
import { pollLipSyncTask, saveClipToServer, startLipSync } from "./api.js";

const activeResumeIds = new Set<string>();

function taskOutputUrl(task: Task): string | undefined {
  if (task.outputUrl) return task.outputUrl;
  const output = task.output;
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output[0];
  return output?.videoUrl ?? output?.url ?? output?.imageUrl;
}

function taskSucceeded(task: Task): boolean {
  return (task.status || "").toUpperCase() === "SUCCEEDED";
}

async function finishLipSyncPoll(clipId: string, taskId: string, sourceVideoUrl: string): Promise<void> {
  try {
    const final = await pollLipSyncTask(taskId);
    const resultUrl = taskOutputUrl(final);
    if (!taskSucceeded(final) || !resultUrl) {
      throw new Error(final.error ?? `lip-sync task ended in ${final.status} with no video`);
    }

    const current = useStore.getState().clips.find((item) => item.id === clipId);
    if (!current) return;
    if (current.lipSyncTaskId !== taskId) return;
    if (current.videoUrl !== sourceVideoUrl) {
      useStore.getState().updateClip(clipId, {
        lipSyncStatus: "failed",
        lastError: "Lip-sync result ignored because the clip video changed.",
      });
      return;
    }

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

    const latest = useStore.getState().clips.find((item) => item.id === clipId);
    if (!latest || latest.lipSyncTaskId !== taskId || latest.videoUrl !== sourceVideoUrl) return;

    useStore.getState().updateClip(clipId, {
      videoUrl: saved.videoUrl,
      lipSyncStatus: "ready",
      lipSyncModel: SYNC_LIPSYNC_MODEL,
      lastError: undefined,
    });
  } catch (error) {
    const current = useStore.getState().clips.find((item) => item.id === clipId);
    if (current?.lipSyncTaskId === taskId) {
      useStore.getState().updateClip(clipId, {
        lipSyncStatus: "failed",
        lastError: getErrorMessage(error),
      });
    }
    throw error;
  }
}

export async function applyLipSyncToClip(clipId: string): Promise<void> {
  const state = useStore.getState();
  const clip = state.clips.find((item) => item.id === clipId);
  if (!clip?.videoUrl) throw new Error("Selected clip has no video to lip-sync.");
  if (!state.audioUrl) throw new Error("Upload a song before using lip-sync.");
  if (clip.end <= clip.start) throw new Error("Selected clip has an invalid timeline range.");
  if (clip.lipSyncStatus === "queued" || clip.lipSyncStatus === "generating") {
    throw new Error("This clip is already lip-syncing.");
  }

  const sourceVideoUrl = clip.videoUrl;
  let ownedTaskId: string | null = null;
  useStore.getState().updateClip(clipId, {
    lipSyncStatus: "queued",
    lipSyncSourceVideoUrl: sourceVideoUrl,
    lipSyncModel: SYNC_LIPSYNC_MODEL,
    lipSyncTaskId: undefined,
    lastError: undefined,
  });

  try {
    const started = await startLipSync({
      videoUrl: sourceVideoUrl,
      audioUrl: state.audioUrl,
      start: clip.start,
      end: clip.end,
    });
    ownedTaskId = started.id;
    useStore.getState().updateClip(clipId, {
      lipSyncTaskId: started.id,
      lipSyncStatus: "generating",
    });
    await finishLipSyncPoll(clipId, started.id, sourceVideoUrl);
  } catch (error) {
    const current = useStore.getState().clips.find((item) => item.id === clipId);
    const ownsQueuedStart = ownedTaskId === null
      && current?.lipSyncStatus === "queued"
      && current.lipSyncSourceVideoUrl === sourceVideoUrl
      && !current.lipSyncTaskId;
    const ownsProviderTask = ownedTaskId !== null && current?.lipSyncTaskId === ownedTaskId;
    if (ownsQueuedStart || ownsProviderTask) {
      useStore.getState().updateClip(clipId, {
        lipSyncStatus: "failed",
        lastError: getErrorMessage(error),
      });
    }
    throw error;
  }
}

export function resumeInflightLipSyncJobs(): void {
  for (const clip of useStore.getState().clips) {
    if (clip.lipSyncStatus === "queued" && !clip.lipSyncTaskId) {
      useStore.getState().updateClip(clip.id, {
        lipSyncStatus: "failed",
        lastError: "Lip-sync start was interrupted before a provider task was created. Try again.",
      });
      continue;
    }
    if (clip.lipSyncStatus === "generating" && (!clip.lipSyncTaskId || !clip.lipSyncSourceVideoUrl)) {
      useStore.getState().updateClip(clip.id, {
        lipSyncStatus: "failed",
        lastError: "Lip-sync task metadata was incomplete after reload. Try again.",
      });
      continue;
    }
    if (
      clip.lipSyncStatus !== "generating" ||
      !clip.lipSyncTaskId ||
      !clip.lipSyncSourceVideoUrl ||
      activeResumeIds.has(clip.lipSyncTaskId)
    ) continue;

    const taskId = clip.lipSyncTaskId;
    activeResumeIds.add(taskId);
    void finishLipSyncPoll(clip.id, taskId, clip.lipSyncSourceVideoUrl)
      .catch((error) => console.warn("resumed lip-sync failed", error))
      .finally(() => activeResumeIds.delete(taskId));
  }
}
