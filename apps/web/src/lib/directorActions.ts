import { AGNES_VIDEO_MODEL, getErrorMessage } from "@mvs/shared";
import { generateTextToImage, renderTimeline } from "./api.js";
import { compileDirectorImageRequest, compileDirectorVideoRequest } from "./directorPrompts.js";
import { enqueueGeneration } from "./scheduler.js";
import { useStore } from "./store.js";

function approvedPlan() {
  const plan = useStore.getState().directorPlan;
  if (!plan?.approvedAt) throw new Error("Approve the BeatSync video plan before generating storyboard images.");
  return plan;
}

export async function generateStoryboardImage(shotId: string): Promise<string> {
  const state = useStore.getState();
  const plan = approvedPlan();
  const shot = plan.shots.find((item) => item.id === shotId);
  if (!shot) throw new Error("Director shot not found.");
  state.setDirectorShotImage(shotId, { status: "generating" });
  try {
    const request = compileDirectorImageRequest(
      shot,
      state.productionBible ?? {},
      state.referenceAssets,
    );
    const image = await generateTextToImage(request);
    useStore.getState().setDirectorShotImage(shotId, { status: "ready", url: image.url });
    return image.url;
  } catch (error) {
    const message = getErrorMessage(error);
    useStore.getState().setDirectorShotImage(shotId, { status: "failed", error: message });
    throw new Error(`Storyboard image failed for ${shot.role}: ${message}`);
  }
}

export async function generateStoryboardImages(
  onProgress?: (completed: number, total: number) => void,
): Promise<void> {
  const plan = approvedPlan();
  const pending = plan.shots.filter((shot) => !(shot.imageUrl && shot.imageStatus === "ready"));
  let completed = 0;
  onProgress?.(completed, pending.length);
  for (const shot of pending) {
    await generateStoryboardImage(shot.id);
    completed += 1;
    onProgress?.(completed, pending.length);
  }
}

export function approveAllStoryboardImages(): void {
  const plan = approvedPlan();
  for (const shot of plan.shots) {
    if (shot.imageStatus === "ready" && shot.imageUrl) useStore.getState().approveDirectorImage(shot.id, true);
  }
}

export function regenerateDirectorVideo(shotId: string): string {
  const state = useStore.getState();
  const plan = approvedPlan();
  const shot = plan.shots.find((item) => item.id === shotId);
  if (!shot) throw new Error("Director shot not found.");
  if (!shot.imageApproved || !shot.imageUrl) {
    throw new Error("Approve this storyboard image before generating its video clip.");
  }
  const clip = state.clips.find((item) => item.id === shot.clipId);
  if (!clip) throw new Error("Director timeline clip not found.");
  const compiled = compileDirectorVideoRequest(shot, state.productionBible ?? {}, state.referenceAssets);
  state.approveDirectorClip(shotId, false);
  state.updateClip(clip.id, {
    source: "imageToVideo",
    archetypeUrl: shot.imageUrl,
    prompt: compiled.promptText,
    negativePrompt: compiled.negativePrompt || undefined,
    referenceAssetIds: compiled.referenceAssetIds,
    model: AGNES_VIDEO_MODEL,
    status: "empty",
    videoUrl: undefined,
    thumbnailUrl: undefined,
    generationTaskId: undefined,
    lastError: undefined,
  });
  return enqueueGeneration({
    clipId: clip.id,
    source: "imageToVideo",
    seedImageUrl: shot.imageUrl,
    prompt: compiled.promptText,
    negativePrompt: compiled.negativePrompt,
    duration: shot.end - shot.start,
    sectionLabel: shot.sectionLabel,
    energy: shot.energy,
    model: AGNES_VIDEO_MODEL,
  });
}

export function enqueueDirectorVideos(): string[] {
  const state = useStore.getState();
  const plan = approvedPlan();
  const unapproved = plan.shots.filter((shot) => !shot.imageApproved || !shot.imageUrl);
  if (unapproved.length) {
    throw new Error(`Approve all storyboard images before generating video (${unapproved.length} remaining).`);
  }
  const jobIds: string[] = [];
  for (const shot of plan.shots) {
    const clip = state.clips.find((item) => item.id === shot.clipId);
    if (!clip) throw new Error(`Timeline clip missing for ${shot.role}.`);
    if (clip.status === "ready" && clip.videoUrl) continue;
    if (clip.status === "queued" || clip.status === "generating") continue;
    jobIds.push(regenerateDirectorVideo(shot.id));
  }
  useStore.getState().setDirectorStage("clips");
  return jobIds;
}

export function approveAllReadyDirectorClips(): void {
  const state = useStore.getState();
  const plan = approvedPlan();
  for (const shot of plan.shots) {
    const clip = state.clips.find((item) => item.id === shot.clipId);
    if (clip?.status === "ready" && clip.videoUrl) state.approveDirectorClip(shot.id, true);
  }
}

export async function renderDirectorFinal(
  onUpdate?: Parameters<typeof renderTimeline>[1]["onUpdate"],
): Promise<string> {
  const state = useStore.getState();
  const plan = approvedPlan();
  if (!state.audioUrl || !state.analysis) throw new Error("The project song is missing.");
  const missingApproval = plan.shots.filter((shot) => !shot.videoApproved);
  if (missingApproval.length) {
    throw new Error(`Approve all generated clips before final render (${missingApproval.length} remaining).`);
  }
  const clips = plan.shots.map((shot) => {
    const clip = state.clips.find((item) => item.id === shot.clipId);
    if (!clip?.videoUrl || clip.status !== "ready") throw new Error(`Approved clip is not ready: ${shot.role}.`);
    return { start: shot.start, end: shot.end, videoUrl: clip.videoUrl, source: clip.source };
  });
  let projectId = state.projectId;
  if (!projectId) {
    projectId = `proj-${crypto.randomUUID().slice(0, 8)}`;
    useStore.setState({ projectId });
  }
  const result = await renderTimeline(
    {
      projectId,
      audioUrl: state.audioUrl,
      duration: state.analysis.duration,
      clips,
      fades: false,
    },
    { onUpdate },
  );
  useStore.getState().setDirectorFinalUrl(result.url);
  useStore.getState().setDirectorStage("final");
  return result.url;
}
