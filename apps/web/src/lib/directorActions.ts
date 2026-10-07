import { AGNES_VIDEO_MODEL, getErrorMessage, normalizeProductionLocks } from "@mvs/shared";
import { generateTextToImage, renderTimeline } from "./api.js";
import { compileDirectorImageRequest, compileDirectorVideoRequest } from "./directorPrompts.js";
import { enqueueGeneration } from "./scheduler.js";
import { useStore } from "./store.js";

function approvedPlan() {
  const plan = useStore.getState().directorPlan;
  if (!plan) throw new Error("No Director plan is loaded.");
  if (plan.planningBasis !== "professional-treatment") {
    throw new Error("This is a Legacy Director plan. Upgrade through Lyrics → Song Understanding → Treatment before Professional Director generation.");
  }
  if (!plan.approvedAt) throw new Error("Approve the BeatSync video plan before generating storyboard images.");
  const state = useStore.getState();
  const bible = normalizeProductionLocks(state.productionBible ?? {}, state.referenceAssets);
  if (!bible.characterLocks!.some((lock) => lock.locked && state.referenceAssets.some((ref) => ref.id === lock.referenceAssetId && ref.url))) {
    throw new Error("Select at least one active Character Lock before generation.");
  }
  return plan;
}

export async function generateStoryboardImage(shotId: string, revisionInstruction = ""): Promise<string> {
  const state = useStore.getState();
  const plan = approvedPlan();
  const shot = plan.shots.find((item) => item.id === shotId);
  if (!shot) throw new Error("Director shot not found.");
  state.setDirectorShotImage(shotId, { status: "generating" });
  const generationShot = useStore.getState().directorPlan?.shots.find((item) => item.id === shotId);
  const isCurrent = () => useStore.getState().directorPlan?.shots.find((item) => item.id === shotId) === generationShot;
  try {
    let request = compileDirectorImageRequest(
      shot,
      state.productionBible ?? {},
      state.referenceAssets,
    );
    const revision = revisionInstruction.trim();
    if (revision) {
      const existing = shot.imageUrl
        ? [{ id: `revision_${shot.id}`, url: shot.imageUrl, name: "Approved storyboard to revise", role: "style" as const, locked: true }]
        : [];
      const mergedRefs = [...(request.referenceImages ?? []), ...existing].slice(0, 8);
      request = {
        ...request,
        promptText: `${request.promptText}

[USER REVISION - APPLY THIS CHANGE]
${revision}
Preserve all Character Locks, Asset Locks, identity, wardrobe, props, location continuity, camera intent, and every detail not explicitly changed above.`,
        mode: mergedRefs.length >= 2 ? "compose" : mergedRefs.length === 1 ? "img2img" : "text2img",
        ...(mergedRefs.length ? { referenceImages: mergedRefs } : {}),
      };
    }
    const image = await generateTextToImage(request);
    if (!isCurrent()) throw new Error("The shot changed during generation. Generate its updated storyboard again.");
    useStore.getState().setDirectorShotImage(shotId, { status: "ready", url: image.url });
    return image.url;
  } catch (error) {
    const message = getErrorMessage(error);
    if (isCurrent()) useStore.getState().setDirectorShotImage(shotId, { status: "failed", error: message });
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

export function regenerateDirectorVideo(shotId: string, revisionInstruction = ""): string {
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
  const revision = revisionInstruction.trim();
  const revisedPrompt = revision
    ? `${compiled.promptText}

[USER VIDEO REVISION - APPLY THIS CHANGE]
${revision}
Preserve identity, wardrobe, props, location, approved storyboard composition, and all continuity details not explicitly changed above.`
    : compiled.promptText;
  state.approveDirectorClip(shotId, false);
  state.updateClip(clip.id, {
    source: "imageToVideo",
    archetypeUrl: shot.imageUrl,
    prompt: revisedPrompt,
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
    prompt: revisedPrompt,
    negativePrompt: compiled.negativePrompt,
    duration: shot.end - shot.start,
    sectionLabel: shot.sectionLabel,
    energy: shot.energy,
    model: AGNES_VIDEO_MODEL,
    aspectRatio: plan.promo?.aspectRatio ?? "16:9",
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
  onUpdate?: NonNullable<Parameters<typeof renderTimeline>[1]>["onUpdate"],
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
      projectId: `${projectId}-export-${crypto.randomUUID().slice(0, 8)}`,
      audioUrl: state.audioUrl,
      duration: plan.promo?.duration ?? state.analysis.duration,
      aspectRatio: plan.promo?.aspectRatio ?? "16:9",
      clips,
      fades: false,
    },
    { onUpdate },
  );
  const current = useStore.getState();
  if (current.songId !== state.songId || current.audioUrl !== state.audioUrl || current.directorPlan !== plan) {
    throw new Error("The project changed during rendering. This older result was not applied; render the current plan again.");
  }
  useStore.getState().setDirectorFinalUrl(result.url);
  useStore.getState().setDirectorStage("final");
  return result.url;
}
