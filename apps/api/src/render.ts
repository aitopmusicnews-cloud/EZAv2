import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { paths, storage } from "./storage.js";
import { config } from "./config.js";
import { runFfmpeg, probeDuration } from "./ffmpeg.js";
import { assertSafeHost } from "./net.js";

export type RenderClip = {
  start: number;
  end: number;
  videoUrl: string;
  /** Agnes sources are already exact-duration visuals and are never time-stretched. */
  source?: string;
};

export type RenderRequest = {
  projectId: string;
  audioUrl: string;
  duration: number;
  clips: RenderClip[];
  aspectRatio?: "9:16" | "16:9" | "4:5" | "1:1";
  /** When true, apply a 150ms fade-in/out at each clip edge. Off by default. */
  fades?: boolean;
};

type TimelineSlice = {
  start: number;
  end: number;
  clip: RenderClip | null;
  clipIndex: number | null;
};

const FADE_DURATION = 0.15;
const FPS = 30;

function outputSize(aspectRatio: RenderRequest["aspectRatio"]): { width: number; height: number } {
  if (aspectRatio === "9:16") return { width: 720, height: 1280 };
  if (aspectRatio === "4:5") return { width: 720, height: 900 };
  if (aspectRatio === "1:1") return { width: 720, height: 720 };
  return { width: 1280, height: 720 };
}
const EPSILON = 0.0005;

function safeProjectToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 120) || "render";
}

function isAgnesSource(source?: string): boolean {
  return source === "textToVideo" || source === "imageToVideo" || source === "keyframeToVideo";
}

/**
 * Split the timeline into non-overlapping slices. When clips overlap, preserve
 * the previous renderer's overlay semantics by selecting the clip that appears
 * latest in req.clips for the overlap interval.
 */
function buildTimelineSlices(req: RenderRequest): TimelineSlice[] {
  const duration = req.duration;
  const bounded = req.clips
    .map((clip, index) => ({
      clip,
      index,
      start: Math.max(0, Math.min(duration, clip.start)),
      end: Math.max(0, Math.min(duration, clip.end)),
    }))
    .filter((item) => item.end - item.start > EPSILON);

  const boundaries = [
    0,
    duration,
    ...bounded.flatMap((item) => [item.start, item.end]),
  ]
    .map((value) => Number(value.toFixed(6)))
    .sort((a, b) => a - b)
    .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]!) > EPSILON);

  const slices: TimelineSlice[] = [];
  const pushSlice = (slice: TimelineSlice) => {
    const prev = slices[slices.length - 1];
    if (
      prev &&
      prev.clipIndex === slice.clipIndex &&
      Math.abs(prev.end - slice.start) <= EPSILON
    ) {
      prev.end = slice.end;
      return;
    }
    slices.push(slice);
  };

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]!;
    const end = boundaries[i + 1]!;
    if (end - start <= EPSILON) continue;

    let selected: (typeof bounded)[number] | null = null;
    for (const item of bounded) {
      if (item.start <= start + EPSILON && item.end >= end - EPSILON) {
        if (!selected || item.index > selected.index) selected = item;
      }
    }

    pushSlice({
      start,
      end,
      clip: selected?.clip ?? null,
      clipIndex: selected?.index ?? null,
    });
  }

  return slices;
}

function concatFileLine(path: string): string {
  const absolutePath = resolve(path);
  return `file '${absolutePath.replace(/'/g, "'\\''")}'`;
}

async function renderBlackSlice(outputPath: string, duration: number, width: number, height: number): Promise<void> {
  await runFfmpeg([
    "-f", "lavfi",
    "-i", `color=c=black:s=${width}x${height}:r=${FPS}:d=${duration.toFixed(6)}`,
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-y",
    outputPath,
  ]);
}

async function renderClipSlice(
  clip: RenderClip,
  sliceStart: number,
  sliceEnd: number,
  outputPath: string,
  fades: boolean,
  probeCache: Map<string, number>,
  width: number,
  height: number,
): Promise<void> {
  const segmentDuration = sliceEnd - sliceStart;
  const slotDuration = clip.end - clip.start;
  const agnes = isAgnesSource(clip.source);

  let trimStart = Math.max(0, sliceStart - clip.start);
  let trimDuration = segmentDuration;
  let setPts = "PTS-STARTPTS";

  if (!agnes) {
    let sourceDuration = probeCache.get(clip.videoUrl);
    if (sourceDuration == null) {
      try {
        sourceDuration = await probeDuration(clip.videoUrl);
      } catch (err) {
        console.warn(`render: probe failed for ${clip.videoUrl}, using 1x playback`, err);
        sourceDuration = slotDuration;
      }
      probeCache.set(clip.videoUrl, sourceDuration);
    }

    const stretch = Math.max(0.25, Math.min(8, slotDuration / sourceDuration));
    trimStart /= stretch;
    trimDuration /= stretch;
    setPts = `(PTS-STARTPTS)*${stretch.toFixed(6)}`;
  }

  const filters = [
    `trim=start=${trimStart.toFixed(6)}:duration=${trimDuration.toFixed(6)}`,
    `setpts=${setPts}`,
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `fps=${FPS}`,
    "setsar=1",
    `tpad=stop_mode=clone:stop_duration=${segmentDuration.toFixed(6)}`,
    `trim=duration=${segmentDuration.toFixed(6)}`,
  ];

  if (fades) {
    const fadeDuration = Math.min(FADE_DURATION, Math.max(0.01, segmentDuration / 2));
    if (Math.abs(sliceStart - clip.start) <= EPSILON) {
      filters.push(`fade=t=in:st=0:d=${fadeDuration.toFixed(3)}`);
    }
    if (Math.abs(sliceEnd - clip.end) <= EPSILON) {
      filters.push(
        `fade=t=out:st=${Math.max(0, segmentDuration - fadeDuration).toFixed(6)}:d=${fadeDuration.toFixed(3)}`,
      );
    }
  }
  filters.push("format=yuv420p");

  await runFfmpeg([
    "-i", clip.videoUrl,
    "-vf", filters.join(","),
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-t", segmentDuration.toFixed(6),
    "-y",
    outputPath,
  ]);
}

/**
 * Stitch a timeline into an MP4 without opening every source clip in one
 * ffmpeg process. Each visible timeline slice is normalized sequentially,
 * then the local parts are concatenated with stream copy and the original
 * song is muxed in as the only audio track.
 */
export async function renderTimeline(req: RenderRequest): Promise<{ url: string }> {
  if (!Number.isFinite(req.duration) || req.duration <= 0) {
    throw new Error("render duration must be positive");
  }

  // SSRF guard: every URL ffmpeg sees comes from the client. Refuse
  // pre-flight if any of them resolve to a private/loopback IP.
  for (const u of [req.audioUrl, ...req.clips.map((c) => c.videoUrl)]) {
    if (/^https?:\/\//i.test(u)) await assertSafeHost(u);
  }

  await mkdir(paths.RENDERS, { recursive: true });
  const { width, height } = outputSize(req.aspectRatio);
  const outputName = `${req.projectId}.mp4`;
  const outputPath = join(paths.RENDERS, outputName);
  const workDir = join(
    paths.RENDERS,
    `.parts-${safeProjectToken(req.projectId)}-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  await mkdir(workDir, { recursive: true });

  try {
    const slices = buildTimelineSlices(req);
    const probeCache = new Map<string, number>();
    const partPaths: string[] = [];

    // Process one visible slice at a time. This is the key memory guard:
    // ffmpeg never has every project clip open/decoded at once.
    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i]!;
      const partPath = join(workDir, `part-${String(i).padStart(4, "0")}.mp4`);
      if (slice.clip) {
        await renderClipSlice(
          slice.clip,
          slice.start,
          slice.end,
          partPath,
          req.fades === true,
          probeCache,
          width,
          height,
        );
      } else {
        await renderBlackSlice(partPath, slice.end - slice.start, width, height);
      }
      partPaths.push(partPath);
    }

    if (!partPaths.length) {
      const blackPath = join(workDir, "part-0000.mp4");
      await renderBlackSlice(blackPath, req.duration, width, height);
      partPaths.push(blackPath);
    }

    const concatListPath = join(workDir, "concat.txt");
    const visualPath = join(workDir, "visual.mp4");
    await writeFile(
      concatListPath,
      partPaths.map(concatFileLine).join("\n") + "\n",
      "utf8",
    );

    // Concatenation is stream-copy only: all parts were encoded with the same
    // dimensions, fps, codec and pixel format above.
    await runFfmpeg([
      "-f", "concat",
      "-safe", "0",
      "-i", concatListPath,
      "-map", "0:v:0",
      "-c:v", "copy",
      "-an",
      "-movflags", "+faststart",
      "-y",
      visualPath,
    ]);

    // Final mux is also video stream-copy, so memory stays low. Clip audio is
    // never carried into part files; the original uploaded song is authoritative.
    await runFfmpeg([
      "-i", visualPath,
      "-i", req.audioUrl,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-t", req.duration.toFixed(6),
      "-shortest",
      "-y",
      outputPath,
    ]);

    const { publicUrl } = await storage.saveRender(outputPath, outputName, "video/mp4");
    if (config.STORAGE_BACKEND === "s3") {
      await unlink(outputPath).catch(() => {});
    }
    return { url: publicUrl };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function writeRenderManifest(projectId: string, req: RenderRequest): Promise<void> {
  await storage.saveJson(`renders/${projectId}.manifest.json`, req);
}
