import type {
  AudioAnalysis,
  ImageToVideoRequest,
  KeyframeToVideoRequest,
  TextToVideoRequest,
  ProjectMeta,
  SavedProject,
  RenderEntry,
  SavedClip,
  SavedImage,
  LibraryFolder,
  Task,
} from "@mvs/shared";
export type { ProjectMeta, SavedProject, RenderEntry, SavedClip, SavedImage, LibraryFolder };

export class ApiError extends Error {
  status: number;
  rateLimited: boolean;
  constructor(status: number, message: string, rateLimited = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    let parsed: { error?: string; rateLimited?: boolean } | null = null;
    try { parsed = JSON.parse(text); } catch {}
    const msg = parsed?.error ?? text;
    throw new ApiError(res.status, msg, parsed?.rateLimited === true);
  }
  return res.json() as Promise<T>;
}

export async function uploadSong(file: File): Promise<{ id: string; audioUrl: string; filename: string; analysis: AudioAnalysis }> {
  const fd = new FormData();
  fd.append("file", file);
  return jsonOrThrow(await fetch("/api/songs/upload", { method: "POST", body: fd }));
}

export async function uploadImage(file: File): Promise<{ id: string; url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return jsonOrThrow(await fetch("/api/images/upload", { method: "POST", body: fd }));
}

export async function uploadVideo(file: File): Promise<{ id: string; url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return jsonOrThrow(await fetch("/api/videos/upload", { method: "POST", body: fd }));
}

export async function extractLastFrame(videoUrl: string, time?: number): Promise<{ url: string }> {
  return jsonOrThrow(
    await fetch("/api/videos/extract-last-frame", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoUrl, time }),
    })
  );
}

export async function sliceAudio(audioUrl: string, start: number, end: number): Promise<{ url: string }> {
  return jsonOrThrow(
    await fetch("/api/audio/slice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioUrl, start, end }),
    })
  );
}

export async function startImageToVideo(req: ImageToVideoRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/image-to-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function startKeyframeToVideo(req: KeyframeToVideoRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/keyframe-to-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function startTextToVideo(req: TextToVideoRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/text-to-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function getTask(id: string): Promise<Task> {
  return jsonOrThrow(await fetch(`/api/tasks/${id}`));
}

export async function pollTask(id: string, intervalMs = 2500, timeoutMs = 600_000): Promise<Task> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await getTask(id);
    if (t.status === "SUCCEEDED" || t.status === "FAILED" || t.status === "CANCELLED") return t;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("task timed out");
}

export type RenderRequest = {
  projectId: string;
  audioUrl: string;
  duration: number;
  clips: Array<{
    start: number;
    end: number;
    videoUrl: string;
    source?: string;
  }>;
  fades?: boolean;
};

export type RenderJobState = "queued" | "running" | "succeeded" | "failed";

export interface RenderJob {
  id: string;
  state: RenderJobState;
  enqueuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  url: string | null;
  error: string | null;
  queuePosition: number | null;
}

export interface RenderSubmitResponse {
  renderId: string;
  state: RenderJobState;
  queuePosition: number | null;
}

/** Submit a render job. Returns the renderId — actual work happens
 *  asynchronously on the server; poll `getRenderJob(renderId)` for status. */
export async function submitRender(req: RenderRequest): Promise<RenderSubmitResponse> {
  return jsonOrThrow(await fetch("/api/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function getRenderJob(renderId: string): Promise<RenderJob> {
  return jsonOrThrow(await fetch(`/api/render/jobs/${renderId}`));
}

/** Convenience: submit a render and poll until it succeeds, fails, or hits
 *  the timeout. The caller can also use submitRender + getRenderJob directly
 *  if it wants to drive its own polling cadence (e.g. progress bar). */
export async function renderTimeline(
  req: RenderRequest,
  opts: { intervalMs?: number; timeoutMs?: number; onUpdate?: (j: RenderJob) => void } = {},
): Promise<{ url: string }> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
  const { renderId } = await submitRender(req);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getRenderJob(renderId);
    opts.onUpdate?.(job);
    if (job.state === "succeeded" && job.url) return { url: job.url };
    if (job.state === "failed") throw new Error(job.error ?? "render failed");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("render timed out");
}

// Projects / Library -------------------------------------------------------

export async function listProjects(): Promise<ProjectMeta[]> {
  const res = await jsonOrThrow<{ projects: ProjectMeta[] }>(await fetch("/api/projects"));
  return res.projects;
}

export async function saveProjectToServer(
  id: string,
  name: string,
  state: Record<string, unknown>,
): Promise<ProjectMeta> {
  return jsonOrThrow(await fetch("/api/projects/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, name, state }),
  }));
}

export async function loadProjectFromServer(id: string): Promise<SavedProject> {
  return jsonOrThrow(await fetch(`/api/projects/${id}`));
}

export async function deleteProjectOnServer(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`/api/projects/${id}`, { method: "DELETE" }));
}

export async function listRenders(): Promise<RenderEntry[]> {
  const res = await jsonOrThrow<{ renders: RenderEntry[] }>(await fetch("/api/library/renders"));
  return res.renders;
}

// Clip Library -------------------------------------------------------------

export async function listSavedClips(): Promise<SavedClip[]> {
  const res = await jsonOrThrow<{ clips: SavedClip[] }>(await fetch("/api/clips"));
  return res.clips;
}

export async function saveClipToServer(clip: Omit<SavedClip, "savedAt">): Promise<SavedClip> {
  return jsonOrThrow(await fetch("/api/clips/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(clip),
  }));
}

export async function deleteClipOnServer(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`/api/clips/${id}`, { method: "DELETE" }));
}

// Image Library -----------------------------------------------------------

export async function listSavedImages(): Promise<SavedImage[]> {
  const res = await jsonOrThrow<{ images: SavedImage[] }>(await fetch("/api/library/images"));
  return res.images;
}

export async function saveImageToLibrary(image: Omit<SavedImage, "savedAt">): Promise<SavedImage> {
  return jsonOrThrow(await fetch("/api/library/images/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(image),
  }));
}

export async function deleteImageFromLibrary(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`/api/library/images/${id}`, { method: "DELETE" }));
}

// Library Folders ---------------------------------------------------------

export async function listLibraryFolders(): Promise<LibraryFolder[]> {
  const res = await jsonOrThrow<{ folders: LibraryFolder[] }>(await fetch("/api/library/folders"));
  return res.folders;
}

export async function saveLibraryFolder(folder: Omit<LibraryFolder, "createdAt">): Promise<LibraryFolder> {
  return jsonOrThrow(await fetch("/api/library/folders/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(folder),
  }));
}

export async function deleteLibraryFolder(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`/api/library/folders/${id}`, { method: "DELETE" }));
}
