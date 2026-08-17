import { z } from "zod";

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

export const AGNES_VIDEO_MODEL = "agnes-video-v2.0" as const;
export const AGNES_IMAGE_MODEL = "agnes-image-2.1-flash" as const;
export const SYNC_LIPSYNC_MODEL = "sync-3" as const;
export type GenerationModel = typeof AGNES_VIDEO_MODEL;
export type ImageGenerationModel = typeof AGNES_IMAGE_MODEL;
export type LipSyncModel = typeof SYNC_LIPSYNC_MODEL;
export type ActiveClipSource = "textToVideo" | "imageToVideo" | "keyframeToVideo" | "library" | "upload";
export type LipSyncStatus = "idle" | "queued" | "generating" | "ready" | "failed";

export const AudioSection = z.object({
  start: z.number(),
  end: z.number(),
  label: z.string(),
});
export type AudioSection = z.infer<typeof AudioSection>;

export const AudioAnalysis = z.object({
  duration: z.number(),
  bpm: z.number(),
  key: z.string(),
  beats: z.array(z.number()),
  downbeats: z.array(z.number()),
  onsets: z.array(z.number()),
  rmsCurve: z.array(z.number()),
  sections: z.array(AudioSection),
});
export type AudioAnalysis = z.infer<typeof AudioAnalysis>;

export const Clip = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  source: z.enum(["textToVideo", "imageToVideo", "keyframeToVideo", "library", "upload"]),
  status: z.enum(["empty", "queued", "generating", "ready", "failed"]),
  prompt: z.string().optional(),
  videoUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  generationTaskId: z.string().optional(),
  model: z.string().optional(),
  referenceImage: z.string().optional(),
  sectionLabel: z.string().optional(),
  archetypeUrl: z.string().optional(),
  keyframeEndUrl: z.string().optional(),
  lastError: z.string().optional(),
  imagePrompt: z.string().optional(),
  lipSyncTaskId: z.string().optional(),
  lipSyncStatus: z.enum(["idle", "queued", "generating", "ready", "failed"]).optional(),
  lipSyncSourceVideoUrl: z.string().optional(),
  lipSyncModel: z.string().optional(),
});
export type Clip = z.infer<typeof Clip>;

// Project snapshots deliberately accept historical source/model strings so old
// saved projects can still be opened. The store normalizes those values to the
// active Agnes-only source model before putting them into runtime state.
const SnapshotClip = Clip.extend({
  source: z.string(),
  model: z.string().optional(),
}).passthrough();

export const ProjectSnapshot = z.object({
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  songId: z.string().optional(),
  songFilename: z.string().optional(),
  audioUrl: z.string().optional(),
  analysis: AudioAnalysis.optional(),
  clips: z.array(SnapshotClip).optional(),
  characterImageUrl: z.string().optional(),
  // Kept only so historical snapshots containing these fields still parse.
  avatarId: z.string().optional(),
  avatarName: z.string().optional(),
  lookbook: z.array(z.any()).optional(),
  zoom: z.number().optional(),
  playhead: z.number().optional(),
}).passthrough();
export type ProjectSnapshot = z.infer<typeof ProjectSnapshot>;

export const ImageToVideoRequest = z.object({
  model: z.literal(AGNES_VIDEO_MODEL).optional(),
  promptImage: z.string().min(1),
  promptText: z.string().min(1),
  ratio: z.string().optional(),
  aspectRatio: z.string().optional(),
  duration: z.number().positive(),
});
export type ImageToVideoRequest = z.infer<typeof ImageToVideoRequest>;

export const KeyframeToVideoRequest = z.object({
  model: z.literal(AGNES_VIDEO_MODEL).optional(),
  promptImage: z.string().min(1),
  promptImageEnd: z.string().min(1),
  promptText: z.string().min(1),
  ratio: z.string().optional(),
  aspectRatio: z.string().optional(),
  duration: z.number().positive(),
});
export type KeyframeToVideoRequest = z.infer<typeof KeyframeToVideoRequest>;

export const TextToVideoRequest = z.object({
  model: z.literal(AGNES_VIDEO_MODEL).optional(),
  promptText: z.string().min(1),
  ratio: z.string().optional(),
  aspectRatio: z.string().optional(),
  duration: z.number().positive(),
});
export type TextToVideoRequest = z.infer<typeof TextToVideoRequest>;

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

export interface SavedClip {
  id: string;
  name: string;
  videoUrl: string;
  source: string;
  prompt: string | null;
  duration: number;
  sectionLabel: string | null;
  savedAt: string;
  folderId?: string | null;
  model?: string | null;
  generationTaskId?: string | null;
  lipSyncTaskId?: string | null;
  lipSyncModel?: string | null;
}

export interface SavedImage {
  id: string;
  name: string;
  url: string;
  source: string;
  prompt: string | null;
  model: string | null;
  savedAt: string;
  folderId?: string | null;
}

export interface LibraryFolder {
  id: string;
  name: string;
  parentId: string | null;
  type: "clips" | "images";
  createdAt: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  savedAt: string;
  thumbnailUrl: string | null;
}

export interface SavedProject {
  id: string;
  name: string;
  savedAt: string;
  thumbnailUrl: string | null;
  state: Record<string, unknown>;
  files: string[];
}

export interface RenderEntry {
  name: string;
  url: string;
  size: number;
  modifiedAt: string;
}

export interface Task {
  id: string;
  status: string;
  createdAt?: string | number;
  progress?: number;
  output?: string[] | string | { videoUrl?: string; imageUrl?: string; url?: string } | null;
  outputUrl?: string;
  error?: string;
  errorCode?: string;
}
