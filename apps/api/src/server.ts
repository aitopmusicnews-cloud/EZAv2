import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import {
  saveUpload,
  readAnalysis,
  writeAnalysisError,
  readAnalysisError,
  clearAnalysisError,
  CorruptAnalysisError,
} from "./storage.js";
import { analyzeAudioBytes } from "./audio.js";
import { decodeTaskId } from "./generationJobs.js";
import { agnesJobProgress, refreshAgnesJob, startAgnesVideo } from "./agnesVideo.js";
import { submitRender, getRenderJob } from "./render_queue.js";
import { FfmpegError } from "./ffmpeg.js";
import { extractLastFrame } from "./frames.js";
import { sliceAudio } from "./audio_slice.js";
import { saveProject, listProjects, loadProject, deleteProject, listRenders } from "./projects.js";
import { saveClip, listClips, deleteClip } from "./clips.js";
import { saveImage, listImages, deleteImage } from "./images.js";
import { saveFolder, listFolders, deleteFolder } from "./folders.js";
import { ImageToVideoRequest, KeyframeToVideoRequest, TextToVideoRequest } from "@mvs/shared";

const SafeId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/, "id contains invalid characters");

const app = Fastify({
  logger: { level: "info" },
  bodyLimit: 50 * 1024 * 1024,
});

// WEB_ORIGIN may be a single URL or a comma-separated list. The list form is
// useful when the same task definition is fronted by both an ALB and a
// CloudFront distribution and the SPA can be loaded from either.
const webOrigins = config.WEB_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
await app.register(cors, {
  origin: webOrigins.length === 1 ? webOrigins[0] : webOrigins,
  credentials: true,
});
await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
await app.register(fastifyStatic, {
  root: join(process.cwd(), config.STORAGE_DIR),
  prefix: "/storage/",
  decorateReply: false,
});

// In production, the same container also serves the built SPA at `/`. The
// Dockerfile copies apps/web/dist into /app/web. If WEB_DIST_DIR isn't set or
// the directory doesn't exist (local dev), the registration is skipped — Vite
// is the dev server and proxies /api here.
const webDistDir = config.WEB_DIST_DIR;
const webDistResolved = webDistDir ? resolve(webDistDir) : null;
const serveSpa = !!(webDistResolved && existsSync(webDistResolved));
if (serveSpa) {
  await app.register(fastifyStatic, {
    root: webDistResolved!,
    prefix: "/",
    decorateReply: true,
    wildcard: false,
  });
  // SPA history-mode fallback: anything that's not /api/* or /storage/* and
  // wasn't matched by a static asset returns index.html so client-side routes
  // (/library/clips/abc, etc.) work on hard refresh.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || req.url.startsWith("/storage/")) {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.sendFile("index.html");
  });
}

app.setErrorHandler((err, req, reply) => {
  if (err instanceof z.ZodError) {
    return reply.code(400).send({ error: err.errors.map((e) => e.message).join("; ") });
  }
  if (err instanceof FfmpegError) {
    // ffmpeg stderr can contain absolute file paths and other internals; log
    // it server-side and only return the generic message to clients.
    req.log.error({ err, stderr: err.stderr }, "ffmpeg failure");
    return reply.code(500).send({ error: err.message });
  }
  req.log.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  return reply.code(500).send({ error: msg });
});

app.get("/health", async () => ({ ok: true }));

// Magic-byte sniffing — MIME headers are caller-controlled and can lie.
// Returns true if the buffer's first bytes match a known signature for the
// declared family (audio | image | video).
function sniffMatches(buf: Buffer, family: "audio" | "image" | "video"): boolean {
  if (buf.length < 12) return false;
  const u = (i: number) => buf.readUInt8(i);
  const ascii = (start: number, len: number) =>
    buf.subarray(start, start + len).toString("ascii");

  if (family === "audio") {
    if (ascii(0, 3) === "ID3") return true; // mp3 with id3
    if (u(0) === 0xff && (u(1) & 0xe0) === 0xe0) return true; // mpeg/aac sync
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return true; // wav
    if (ascii(0, 4) === "fLaC") return true; // flac
    if (ascii(0, 4) === "OggS") return true; // ogg/opus
    if (ascii(4, 4) === "ftyp") return true; // m4a/aac-in-mp4
    return false;
  }

  if (family === "video") {
    if (ascii(4, 4) === "ftyp") return true; // mp4/mov/m4v
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "AVI ") return true; // avi
    // webm/mkv — EBML header starts with 1A 45 DF A3
    if (u(0) === 0x1a && u(1) === 0x45 && u(2) === 0xdf && u(3) === 0xa3) return true;
    if (ascii(0, 4) === "OggS") return true; // ogv
    return false;
  }

  // image
  if (u(0) === 0xff && u(1) === 0xd8 && u(2) === 0xff) return true; // jpeg
  if (u(0) === 0x89 && ascii(1, 3) === "PNG") return true; // png
  if (ascii(0, 4) === "GIF8") return true; // gif
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return true; // webp
  return false;
}

function resolvePublicUrl(req: any, publicUrl: string): string {
  let resolved = publicUrl;
  const hostHeader = (req.headers["x-forwarded-host"] as string) || (req.headers["host"] as string);
  if (hostHeader && !hostHeader.includes("localhost") && !hostHeader.includes("127.0.0.1")) {
    const proto = "https"; // Force HTTPS for remote Cloud Run environments to prevent Mixed Content errors
    const keyIndex = publicUrl.indexOf("/storage/");
    if (keyIndex !== -1) {
      const key = publicUrl.substring(keyIndex);
      resolved = `${proto}://${hostHeader}${key}`;
    }
  }
  return resolved;
}

// Songs ----------------------------------------------------------------

app.post("/api/songs/upload", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "no file" });
  const isAud = file.mimetype?.startsWith("audio/") ||
    /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(file.filename);
  if (!isAud) {
    return reply.code(400).send({ error: `expected audio, got ${file.mimetype}` });
  }
  const buf = await file.toBuffer();
  if (!sniffMatches(buf, "audio")) {
    return reply.code(400).send({ error: "file content is not a recognized audio format" });
  }
  const { id, publicUrl } = await saveUpload(buf, file.filename, file.mimetype);
  const resolvedUrl = resolvePublicUrl(req, publicUrl);

  // Song ids are content-addressed, so clear any stale failure before this
  // request-owned analysis attempt. The request does not return until librosa
  // has produced a durable analysis result or a real error.
  await clearAnalysisError(id);
  try {
    const analysis = await analyzeAudioBytes(id, buf, file.filename);
    return reply.send({ id, audioUrl: resolvedUrl, filename: file.filename, analysis });
  } catch (err) {
    app.log.error({ err }, "analysis failed");
    await writeAnalysisError(id, String((err as Error)?.message ?? err));
    throw err;
  }
});

app.post("/api/images/upload", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "no file" });
  const isImg = file.mimetype?.startsWith("image/") ||
    /\.(png|jpg|jpeg|webp|gif|bmp|svg|tiff|jfif)$/i.test(file.filename);
  if (!isImg) {
    return reply.code(400).send({ error: `expected image, got ${file.mimetype}` });
  }
  const buf = await file.toBuffer();
  if (!sniffMatches(buf, "image")) {
    return reply.code(400).send({ error: "file content is not a recognized image format" });
  }
  const { id, publicUrl } = await saveUpload(buf, file.filename, file.mimetype);
  const resolvedUrl = resolvePublicUrl(req, publicUrl);
  return reply.send({ id, url: resolvedUrl });
});

app.post("/api/videos/upload", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "no file" });
  const isVid = file.mimetype?.startsWith("video/") ||
    /\.(mp4|webm|ogg|mov|avi|mkv|m4v)$/i.test(file.filename);
  if (!isVid) {
    return reply.code(400).send({ error: `expected video, got ${file.mimetype}` });
  }
  const buf = await file.toBuffer();
  if (!sniffMatches(buf, "video")) {
    return reply.code(400).send({ error: "file content is not a recognized video format" });
  }
  const { id, publicUrl } = await saveUpload(buf, file.filename, file.mimetype);
  const resolvedUrl = resolvePublicUrl(req, publicUrl);
  return reply.send({ id, url: resolvedUrl });
});

app.get("/api/songs/:id/analysis", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  let analysis;
  try {
    analysis = await readAnalysis(params.id);
  } catch (err) {
    if (err instanceof CorruptAnalysisError) {
      req.log.error({ err, songId: params.id }, "corrupt analysis cache");
      return reply.send({ status: "failed", error: "corrupt analysis cache" });
    }
    throw err;
  }
  if (analysis) return reply.send({ status: "ready", analysis });
  const errMsg = await readAnalysisError(params.id);
  if (errMsg) return reply.send({ status: "failed", error: errMsg });
  return reply.send({ status: "pending" });
});

// Agnes Video V2.0 generation -----------------------------------------

app.post("/api/generate/image-to-video", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  return reply.send(await startAgnesVideo(ImageToVideoRequest.parse(req.body), "imageToVideo"));
});

app.post("/api/generate/keyframe-to-video", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  return reply.send(await startAgnesVideo(KeyframeToVideoRequest.parse(req.body), "keyframeToVideo"));
});

app.post("/api/generate/text-to-video", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  return reply.send(await startAgnesVideo(TextToVideoRequest.parse(req.body), "textToVideo"));
});

// Tasks ----------------------------------------------------------------

app.get("/api/tasks/:id", async (req, reply) => {
  const params = z.object({ id: z.string().min(1).max(500) }).parse(req.params);
  let decoded;
  try {
    decoded = decodeTaskId(params.id);
  } catch {
    return reply.code(400).send({ error: "invalid generation task id" });
  }
  const job = await refreshAgnesJob(decoded.id);
  if (!job) return reply.code(404).send({ error: "generation task not found" });
  const status = job.status === "completed"
    ? "SUCCEEDED"
    : job.status === "failed"
      ? "FAILED"
      : job.status === "pending"
        ? "PENDING"
        : "RUNNING";
  return reply.send({
    id: params.id,
    status,
    createdAt: new Date(job.createdAt).toISOString(),
    progress: job.status === "completed" ? 100 : agnesJobProgress(job),
    output: job.status === "completed" && job.video_url ? [job.video_url] : null,
    error: job.error,
  });
});

// Frame extraction ------------------------------------------------------

const ExtractFrameBody = z.object({
  videoUrl: z.string().url(),
  time: z.number().min(0).optional(),
});

app.post("/api/videos/extract-last-frame", async (req, reply) => {
  const body = ExtractFrameBody.parse(req.body);
  const result = await extractLastFrame(body.videoUrl, body.time);
  return reply.send(result);
});

// Audio slice -----------------------------------------------------------

const SliceBody = z.object({
  audioUrl: z.string().url(),
  start: z.number().min(0),
  end: z.number().positive(),
});

app.post("/api/audio/slice", async (req, reply) => {
  const body = SliceBody.parse(req.body);
  const result = await sliceAudio(body.audioUrl, body.start, body.end);
  return reply.send(result);
});

// Render ---------------------------------------------------------------

// Hard caps so a malformed client can't ask ffmpeg to encode a 10-hour timeline
// or interpolate NaN/Infinity into the filter graph.
const MAX_RENDER_DURATION_S = 60 * 60; // 1h
const MAX_RENDER_CLIPS = 500;

const RenderBody = z
  .object({
    projectId: SafeId,
    audioUrl: z.string().url(),
    duration: z.number().finite().positive().max(MAX_RENDER_DURATION_S),
    clips: z
      .array(
        z
          .object({
            start: z.number().finite().min(0),
            end: z.number().finite().positive(),
            videoUrl: z.string().url(),
            source: z.string().optional(),
          })
          .refine((c) => c.end > c.start, {
            message: "clip end must be greater than start",
          })
      )
      .max(MAX_RENDER_CLIPS),
    fades: z.boolean().default(false),
  })
  .refine((body) => body.clips.every((c) => c.end <= body.duration + 1e-3), {
    message: "clip extends past project duration",
  });

// Submit a render job. Returns immediately with `renderId`; the actual
// ffmpeg work runs in the in-process render queue (one render at a time on
// this task to keep CPU contention predictable). The client polls
// /api/render/jobs/:renderId for status + final URL.
app.post("/api/render", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
  const body = RenderBody.parse(req.body);
  const job = submitRender(body);
  return reply.send({
    renderId: job.id,
    state: job.state,
    queuePosition: job.queuePosition,
  });
});

app.get("/api/render/jobs/:renderId", async (req, reply) => {
  const params = z.object({ renderId: SafeId }).parse(req.params);
  const job = getRenderJob(params.renderId);
  if (!job) return reply.code(404).send({ error: "render job not found" });
  return reply.send(job);
});

// Projects / Library ----------------------------------------------------

const SaveProjectBody = z.object({
  id: SafeId,
  name: z.string().min(1).max(200),
  state: z.record(z.unknown()),
});

app.get("/api/projects", async (_req, reply) => {
  const projects = await listProjects();
  return reply.send({ projects });
});

app.post("/api/projects/save", async (req, reply) => {
  const body = SaveProjectBody.parse(req.body);
  const meta = await saveProject(body.id, body.name, body.state);
  return reply.send(meta);
});

app.get("/api/projects/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  const project = await loadProject(params.id);
  if (!project) return reply.code(404).send({ error: "not found" });
  return reply.send(project);
});

app.delete("/api/projects/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  const deleted = await deleteProject(params.id);
  if (!deleted) return reply.code(404).send({ error: "not found" });
  return reply.send({ ok: true });
});

app.get("/api/library/renders", async (_req, reply) => {
  const renders = await listRenders();
  return reply.send({ renders });
});

// Clip Library ------------------------------------------------------------

const SaveClipBody = z.object({
  id: SafeId,
  name: z.string().min(1).max(200),
  videoUrl: z.string().url(),
  source: z.string(),
  prompt: z.string().nullable(),
  duration: z.number().positive(),
  sectionLabel: z.string().nullable(),
  folderId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  generationTaskId: z.string().nullable().optional(),
});

app.get("/api/clips", async (_req, reply) => {
  const clips = await listClips();
  return reply.send({ clips });
});

app.post("/api/clips/save", async (req, reply) => {
  const body = SaveClipBody.parse(req.body);
  const saved = await saveClip(body);
  return reply.send(saved);
});

app.delete("/api/clips/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  const deleted = await deleteClip(params.id);
  if (!deleted) return reply.code(404).send({ error: "not found" });
  return reply.send({ ok: true });
});

// Image Library --------------------------------------------------------
// Namespaced under /api/library to avoid clashing with /api/images/upload.

const SaveImageBody = z.object({
  id: SafeId,
  name: z.string().min(1).max(200),
  url: z.string().url(),
  source: z.string(),
  prompt: z.string().nullable(),
  model: z.string().nullable(),
  folderId: z.string().nullable().optional(),
});

app.get("/api/library/images", async (_req, reply) => {
  const images = await listImages();
  return reply.send({ images });
});

app.post("/api/library/images/save", async (req, reply) => {
  const body = SaveImageBody.parse(req.body);
  const saved = await saveImage(body);
  return reply.send(saved);
});

app.delete("/api/library/images/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  const deleted = await deleteImage(params.id);
  if (!deleted) return reply.code(404).send({ error: "not found" });
  return reply.send({ ok: true });
});

// Library Folders API --------------------------------------------------

const SaveFolderBody = z.object({
  id: SafeId,
  name: z.string().min(1).max(200),
  parentId: z.string().nullable(),
  type: z.enum(["clips", "images"]),
});

app.get("/api/library/folders", async (_req, reply) => {
  const folders = await listFolders();
  return reply.send({ folders });
});

app.post("/api/library/folders/save", async (req, reply) => {
  const body = SaveFolderBody.parse(req.body);
  const saved = await saveFolder(body);
  return reply.send(saved);
});

app.delete("/api/library/folders/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  const deleted = await deleteFolder(params.id);
  if (!deleted) return reply.code(404).send({ error: "not found" });
  return reply.send({ ok: true });
});

const port = config.PORT;
app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`api listening on http://localhost:${port}`);
});
