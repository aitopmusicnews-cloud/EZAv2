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

export const LyricWord = z.object({
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
  text: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
}).refine((value) => value.end >= value.start, {
  message: "lyric word end must be >= start",
  path: ["end"],
});
export type LyricWord = z.infer<typeof LyricWord>;

export const LyricSegment = z.object({
  id: z.string().min(1),
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(["transcription", "official-aligned", "manual"]),
}).refine((value) => value.end >= value.start, {
  message: "lyric segment end must be >= start",
  path: ["end"],
});
export type LyricSegment = z.infer<typeof LyricSegment>;

export const LyricDocument = z.object({
  source: z.enum(["transcription", "official", "hybrid", "instrumental"]),
  rawText: z.string(),
  draftText: z.string().optional(),
  language: z.string().optional(),
  segments: z.array(LyricSegment),
  words: z.array(LyricWord).optional(),
  correctedAt: z.number().optional(),
  approvedAt: z.number().optional(),
});
export type LyricDocument = z.infer<typeof LyricDocument>;

export const KeyLyricMoment = z.object({
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
  lyric: z.string().min(1),
  meaning: z.string().min(1),
  visualOpportunity: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
}).refine((value) => value.end >= value.start, {
  message: "key lyric moment end must be >= start",
  path: ["end"],
});
export type KeyLyricMoment = z.infer<typeof KeyLyricMoment>;

export const SongUnderstandingSection = z.object({
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
  sourceLabel: z.string().min(1),
  inferredRole: z.string().min(1),
  lyricalPurpose: z.string().min(1),
  musicalPurpose: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
}).refine((value) => value.end >= value.start, {
  message: "Song Understanding section end must be >= start",
  path: ["end"],
});
export type SongUnderstandingSection = z.infer<typeof SongUnderstandingSection>;

export const SongUnderstanding = z.object({
  basis: z.enum(["lyrics+music", "instrumental+vision"]),
  primaryTheme: z.string().min(1),
  secondaryThemes: z.array(z.string()),
  emotionalArc: z.array(z.string()).min(1),
  sections: z.array(SongUnderstandingSection),
  keyLyricMoments: z.array(KeyLyricMoment),
  repeatedHooks: z.array(z.string()),
  characters: z.array(z.string()),
  narrativePerspective: z.string().min(1),
  literalImagery: z.array(z.string()),
  symbolicImagery: z.array(z.string()),
  tensionRelease: z.array(z.string()),
  performanceOpportunities: z.array(z.string()),
  visualMotifs: z.array(z.string()),
  uncertaintyNotes: z.array(z.string()),
  approvedAt: z.number().optional(),
});
export type SongUnderstanding = z.infer<typeof SongUnderstanding>;

// `clips` remains accepted so historical saved projects and the current
// pre-Phase-A UI can migrate safely. New guided projects use `takes` instead.
export const DirectorStage = z.enum([
  "song", "lyrics", "understanding", "treatment", "plan", "images", "clips", "takes", "edit", "final",
]);
export type DirectorStage = z.infer<typeof DirectorStage>;

export const DirectorShot = z.object({
  id: z.string().min(1),
  clipId: z.string().min(1),
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
  sectionLabel: z.string().min(1),
  role: z.string().min(1),
  idea: z.string().min(1),
  camera: z.string().min(1),
  framing: z.string().min(1),
  mood: z.string().min(1),
  location: z.string().min(1),
  energy: z.number().finite().min(0).max(1),
  hero: z.boolean().default(false),
  imageStatus: z.enum(["idle", "generating", "ready", "failed"]).default("idle"),
  imageUrl: z.string().optional(),
  imageApproved: z.boolean().default(false),
  imageError: z.string().optional(),
  videoApproved: z.boolean().default(false),
});
export type DirectorShot = z.infer<typeof DirectorShot>;

export const DirectorTreatment = z.object({
  title: z.string().min(1),
  concept: z.string().min(1),
  style: z.string().min(1),
  pacing: z.string().min(1),
});
export type DirectorTreatment = z.infer<typeof DirectorTreatment>;

export const DirectorPlan = z.object({
  id: z.string().min(1),
  version: z.literal(1).default(1),
  planningBasis: z.enum(["legacy-audio-heuristic", "professional-treatment"]).default("legacy-audio-heuristic"),
  vision: z.string(),
  treatment: DirectorTreatment,
  shots: z.array(DirectorShot).min(1),
  approvedAt: z.number().optional(),
});
export type DirectorPlan = z.infer<typeof DirectorPlan>;

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
  wardrobeProfile: z.string().optional(),
  vehicleProfile: z.string().optional(),
  locationProfile: z.string().optional(),
  stylePrompt: z.string().optional(),
  colorPalette: z.string().optional(),
  continuityPrompt: z.string().optional(),
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
  // Runtime/persisted Zustand state uses null for "not set yet". Accept null
  // as well as omission so saved projects round-trip through this validator.
  projectId: z.string().nullish(),
  projectName: z.string().nullish(),
  songId: z.string().nullish(),
  songFilename: z.string().nullish(),
  audioUrl: z.string().nullish(),
  analysis: AudioAnalysis.nullish(),
  clips: z.array(SnapshotClip).optional(),
  characterImageUrl: z.string().nullish(),
  productionBible: ProductionBible.nullish(),
  referenceAssets: z.array(ReferenceAsset).optional(),
  lyricDocument: LyricDocument.nullish(),
  songUnderstanding: SongUnderstanding.nullish(),
  directorPlan: DirectorPlan.nullish(),
  directorStage: DirectorStage.optional(),
  directorVision: z.string().optional(),
  directorFinalUrl: z.string().nullish(),
  // Kept only so historical snapshots containing these fields still parse.
  avatarId: z.string().optional(),
  avatarName: z.string().optional(),
  lookbook: z.array(z.any()).optional(),
  zoom: z.number().optional(),
  playhead: z.number().optional(),
}).passthrough();
export type ProjectSnapshot = z.infer<typeof ProjectSnapshot>;

export const TranscribeSongRequest = z.object({
  songId: z.string().min(1).max(100),
  audioUrl: z.string().url(),
  duration: z.number().finite().positive(),
});
export type TranscribeSongRequest = z.infer<typeof TranscribeSongRequest>;

export const AlignOfficialLyricsRequest = z.object({
  draft: LyricDocument,
  officialText: z.string().trim().min(1).max(50_000),
});
export type AlignOfficialLyricsRequest = z.infer<typeof AlignOfficialLyricsRequest>;

export const SongUnderstandingRequest = z.object({
  lyrics: LyricDocument,
  analysis: AudioAnalysis,
  vision: z.string().max(12_000).default(""),
});
export type SongUnderstandingRequest = z.infer<typeof SongUnderstandingRequest>;

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
