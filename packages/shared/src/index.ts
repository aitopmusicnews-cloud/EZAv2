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

export const ReferenceRole = z.enum(["character", "vehicle", "wardrobe", "location", "style", "prop"]);
export type ReferenceRole = z.infer<typeof ReferenceRole>;

export const ReferenceAsset = z.object({
  id: z.string().min(1),
  // App-local /storage paths are valid here; the API resolves them to provider-facing HTTPS URLs before calling Agnes.
  url: z.string().min(1),
  name: z.string().optional(),
  role: ReferenceRole,
  locked: z.boolean().optional(),
});
export type ReferenceAsset = z.infer<typeof ReferenceAsset>;

export const SpatialLock = z.object({
  trafficSystem: z.enum(["US_RIGHT_HAND", "UK_LEFT_HAND", "UNSPECIFIED"]).optional(),
  driveSide: z.enum(["LEFT_HAND_DRIVE", "RIGHT_HAND_DRIVE", "UNSPECIFIED"]).optional(),
  driverSeat: z.enum(["FRONT_LEFT", "FRONT_RIGHT", "UNSPECIFIED"]).optional(),
  passengerSeat: z.enum(["FRONT_LEFT", "FRONT_RIGHT", "UNSPECIFIED"]).optional(),
  cameraPosition: z.enum([
    "FRONT_PASSENGER_INTERIOR",
    "FRONT_DRIVER_INTERIOR",
    "CENTER_DASH_INTERIOR",
    "DRIVER_SIDE_EXTERIOR",
    "PASSENGER_SIDE_EXTERIOR",
    "FRONT_EXTERIOR",
    "REAR_EXTERIOR",
    "AERIAL",
    "UNSPECIFIED",
  ]).optional(),
  cameraDirection: z.enum([
    "TOWARD_DRIVER_AND_CENTER_MIRROR",
    "FORWARD",
    "BACKWARD",
    "TOWARD_DRIVER",
    "TOWARD_VEHICLE",
    "UNSPECIFIED",
  ]).optional(),
  vehicleDirection: z.enum(["FORWARD", "REVERSE", "STATIONARY", "UNSPECIFIED"]).optional(),
  competitorPosition: z.enum(["BEHIND", "AHEAD", "ADJACENT", "NONE", "UNSPECIFIED"]).optional(),
  competitorDirection: z.enum(["SAME_DIRECTION", "ONCOMING", "NONE", "UNSPECIFIED"]).optional(),
  rearviewMirrorShows: z.enum([
    "ROAD_BEHIND_AND_COMPETITORS",
    "ROAD_BEHIND",
    "EMPTY_ROAD_BEHIND",
    "UNSPECIFIED",
  ]).optional(),
  windshieldShows: z.enum(["OPEN_ROAD_AHEAD", "ROAD_AHEAD_WITH_TRAFFIC", "UNSPECIFIED"]).optional(),
  allowOncomingTraffic: z.boolean().optional(),
});
export type SpatialLock = z.infer<typeof SpatialLock>;

export const ProductionBible = z.object({
  id: z.string().optional(),
  characterProfile: z.string().optional(),
  vehicleProfile: z.string().optional(),
  stylePrompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  characterReferenceAssetIds: z.array(z.string()).optional(),
  vehicleReferenceAssetIds: z.array(z.string()).optional(),
  defaultSpatialLock: SpatialLock.optional(),
});
export type ProductionBible = z.infer<typeof ProductionBible>;

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
  negativePrompt: z.string().optional(),
  referenceAssetIds: z.array(z.string()).optional(),
  spatialLock: SpatialLock.optional(),
  compiledPrompt: z.string().optional(),
  compiledNegativePrompt: z.string().optional(),
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
  productionBible: ProductionBible.optional(),
  referenceAssets: z.array(ReferenceAsset).optional(),
  // Kept only so historical snapshots containing these fields still parse.
  avatarId: z.string().optional(),
  avatarName: z.string().optional(),
  lookbook: z.array(z.any()).optional(),
  zoom: z.number().optional(),
  playhead: z.number().optional(),
}).passthrough();
export type ProjectSnapshot = z.infer<typeof ProjectSnapshot>;

const VideoPromptFields = {
  negativePrompt: z.string().optional(),
};

export const ImageToVideoRequest = z.object({
  model: z.literal(AGNES_VIDEO_MODEL).optional(),
  promptImage: z.string().min(1),
  promptText: z.string().min(1),
  ratio: z.string().optional(),
  aspectRatio: z.string().optional(),
  duration: z.number().positive(),
  ...VideoPromptFields,
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
  ...VideoPromptFields,
});
export type KeyframeToVideoRequest = z.infer<typeof KeyframeToVideoRequest>;

export const TextToVideoRequest = z.object({
  model: z.literal(AGNES_VIDEO_MODEL).optional(),
  promptText: z.string().min(1),
  ratio: z.string().optional(),
  aspectRatio: z.string().optional(),
  duration: z.number().positive(),
  ...VideoPromptFields,
});
export type TextToVideoRequest = z.infer<typeof TextToVideoRequest>;

export const TextToImageRequest = z.object({
  promptText: z.string().trim().min(1).max(12000),
  size: z.string().regex(/^\d{3,4}x\d{3,4}$/).default("1536x864"),
  mode: z.enum(["text2img", "img2img", "compose"]).optional(),
  referenceImages: z.array(ReferenceAsset).max(8).optional(),
}).superRefine((value, ctx) => {
  const mode = value.mode ?? "text2img";
  const refs = value.referenceImages ?? [];
  if (mode === "img2img" && refs.length !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["referenceImages"], message: "img2img requires exactly one reference image" });
  }
  if (mode === "compose" && refs.length < 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["referenceImages"], message: "compose requires at least two reference images" });
  }
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
