import { join } from "node:path";
import { mkdir, unlink } from "node:fs/promises";
import { paths, storage } from "./storage.js";
import { config } from "./config.js";
import { runFfmpeg } from "./ffmpeg.js";
import { assertSafeHost } from "./net.js";
import { resolveLocalPath } from "./paths.js";

export type PromoMotion = "static" | "push-in" | "zoom-out" | "pan-left" | "pan-right";
export type PromoFit = "cover" | "contain";
export type PromoTextPosition = "top" | "center" | "bottom";

export type PromoScene = {
  url: string;
  kind: "image" | "video";
  duration: number;
  motion?: PromoMotion;
  fit?: PromoFit;
  focalX?: number;
  focalY?: number;
};

export type PromoTextOverlay = {
  text: string;
  start: number;
  end: number;
  position?: PromoTextPosition;
};

export type PromoRenderRequest = {
  projectId: string;
  duration: number;
  aspectRatio: "9:16" | "16:9" | "4:5";
  scenes: PromoScene[];
  textOverlays?: PromoTextOverlay[];
  musicUrl?: string;
  voiceoverUrl?: string;
  musicVolume?: number;
  voiceoverVolume?: number;
  duckMusic?: boolean;
};

function outputSize(aspectRatio: PromoRenderRequest["aspectRatio"]): { width: number; height: number } {
  if (aspectRatio === "9:16") return { width: 1080, height: 1920 };
  if (aspectRatio === "4:5") return { width: 1080, height: 1350 };
  return { width: 1920, height: 1080 };
}

async function resolveInput(url: string): Promise<string> {
  const local = resolveLocalPath(url);
  if (local) return local;
  if (/^https?:\/\//i.test(url)) await assertSafeHost(url);
  return url;
}

function clamp01(value: number | undefined, fallback = 0.5): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, (value as number) / 100));
}

function sceneBaseFilter(scene: PromoScene, width: number, height: number): string {
  const fit = scene.fit ?? "cover";
  if (fit === "contain") {
    return [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      "setsar=1",
      "format=yuv420p",
    ].join(",");
  }

  const fx = clamp01(scene.focalX, 0.5).toFixed(4);
  const fy = clamp01(scene.focalY, 0.5).toFixed(4);
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}:x='max(0,min(iw-ow,(iw-ow)*${fx}))':y='max(0,min(ih-oh,(ih-oh)*${fy}))'`,
    "setsar=1",
    "format=yuv420p",
  ].join(",");
}

function imageMotionFilter(scene: PromoScene, width: number, height: number, fps: number): string {
  const motion = scene.motion ?? "static";
  const frames = Math.max(1, Math.round(scene.duration * fps));
  if (motion === "static") return `fps=${fps}`;

  if (motion === "push-in") {
    return [
      `zoompan=z='min(zoom+0.0012,1.12)'`,
      `x='iw/2-(iw/zoom/2)'`,
      `y='ih/2-(ih/zoom/2)'`,
      "d=1",
      `s=${width}x${height}`,
      `fps=${fps}`,
    ].join(":");
  }

  if (motion === "zoom-out") {
    return [
      `zoompan=z='if(eq(on,0),1.12,max(1.0,zoom-0.0012))'`,
      `x='iw/2-(iw/zoom/2)'`,
      `y='ih/2-(ih/zoom/2)'`,
      "d=1",
      `s=${width}x${height}`,
      `fps=${fps}`,
    ].join(":");
  }

  const progress = `on/${Math.max(1, frames - 1)}`;
  const x = motion === "pan-left"
    ? `(iw-iw/zoom)*(1-${progress})`
    : `(iw-iw/zoom)*${progress}`;
  return [
    "zoompan=z='1.08'",
    `x='${x}'`,
    `y='ih/2-(ih/zoom/2)'`,
    "d=1",
    `s=${width}x${height}`,
    `fps=${fps}`,
  ].join(":");
}

function escapeDrawText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/\r?\n/g, "\\n");
}

function overlayY(position: PromoTextPosition | undefined): string {
  if (position === "top") return "h*0.10";
  if (position === "center") return "(h-text_h)/2";
  return "h-text_h-h*0.12";
}

/**
 * Render a short social promo with deterministic still-image motion, optional
 * uploaded video clips, text overlays, background music and voiceover.
 *
 * This is intentionally separate from the music-video renderer so the
 * existing song-first workflow stays untouched while Promo Mode evolves.
 */
export async function renderPromo(req: PromoRenderRequest): Promise<{ url: string }> {
  if (!req.scenes.length) throw new Error("promo render requires at least one scene");
  const fps = 30;
  const { width, height } = outputSize(req.aspectRatio);
  const totalFromScenes = req.scenes.reduce((sum, scene) => sum + scene.duration, 0);
  if (Math.abs(totalFromScenes - req.duration) > 0.05) {
    throw new Error("promo scene durations must add up to the project duration");
  }

  await mkdir(paths.RENDERS, { recursive: true });
  const outputName = `${req.projectId}-promo.mp4`;
  const outputPath = join(paths.RENDERS, outputName);

  const inputs: string[] = [];
  const filters: string[] = [];

  const resolvedScenes = await Promise.all(req.scenes.map(async (scene) => ({
    ...scene,
    input: await resolveInput(scene.url),
  })));

  for (const scene of resolvedScenes) {
    if (scene.kind === "image") {
      inputs.push("-loop", "1", "-framerate", String(fps), "-i", scene.input);
    } else {
      inputs.push("-stream_loop", "-1", "-i", scene.input);
    }
  }

  const musicInputIndex = req.musicUrl ? resolvedScenes.length : null;
  if (req.musicUrl) {
    inputs.push("-stream_loop", "-1", "-i", await resolveInput(req.musicUrl));
  }
  const voiceInputIndex = req.voiceoverUrl
    ? resolvedScenes.length + (req.musicUrl ? 1 : 0)
    : null;
  if (req.voiceoverUrl) {
    inputs.push("-i", await resolveInput(req.voiceoverUrl));
  }

  const sceneLabels: string[] = [];
  resolvedScenes.forEach((scene, index) => {
    const base = sceneBaseFilter(scene, width, height);
    const duration = scene.duration.toFixed(6);
    const out = `scene${index}`;
    if (scene.kind === "image") {
      const motion = imageMotionFilter(scene, width, height, fps);
      filters.push(
        `[${index}:v]${base},${motion},trim=duration=${duration},setpts=PTS-STARTPTS[${out}]`,
      );
    } else {
      filters.push(
        `[${index}:v]${base},fps=${fps},trim=duration=${duration},setpts=PTS-STARTPTS[${out}]`,
      );
    }
    sceneLabels.push(`[${out}]`);
  });

  filters.push(`${sceneLabels.join("")}concat=n=${sceneLabels.length}:v=1:a=0[promo]`);

  let videoLabel = "promo";
  const overlays = (req.textOverlays ?? []).filter((overlay) => overlay.text.trim() && overlay.end > overlay.start);
  overlays.forEach((overlay, index) => {
    const next = `txt${index}`;
    const fontSize = Math.max(34, Math.round(width * 0.058));
    const text = escapeDrawText(overlay.text.trim());
    filters.push(
      `[${videoLabel}]drawtext=` +
      `text='${text}':` +
      `fontcolor=white:fontsize=${fontSize}:` +
      `x=(w-text_w)/2:y=${overlayY(overlay.position)}:` +
      `box=1:boxcolor=black@0.52:boxborderw=${Math.max(18, Math.round(fontSize * 0.42))}:` +
      `shadowcolor=black@0.75:shadowx=2:shadowy=2:` +
      `enable='between(t,${overlay.start.toFixed(3)},${overlay.end.toFixed(3)})'[${next}]`,
    );
    videoLabel = next;
  });

  const duration = req.duration.toFixed(6);
  const musicVolume = Math.max(0, Math.min(2, req.musicVolume ?? 0.72));
  const voiceVolume = Math.max(0, Math.min(2, req.voiceoverVolume ?? 1));

  if (musicInputIndex !== null) {
    filters.push(
      `[${musicInputIndex}:a]volume=${musicVolume.toFixed(3)},` +
      `atrim=duration=${duration},asetpts=PTS-STARTPTS[music]`,
    );
  }
  if (voiceInputIndex !== null) {
    filters.push(
      `[${voiceInputIndex}:a]volume=${voiceVolume.toFixed(3)},apad,` +
      `atrim=duration=${duration},asetpts=PTS-STARTPTS[voice]`,
    );
  }

  if (musicInputIndex !== null && voiceInputIndex !== null) {
    if (req.duckMusic !== false) {
      filters.push(
        "[music][voice]sidechaincompress=" +
        "threshold=0.025:ratio=10:attack=20:release=280[ducked]",
      );
      filters.push("[ducked][voice]amix=inputs=2:duration=longest:normalize=0[aout]");
    } else {
      filters.push("[music][voice]amix=inputs=2:duration=longest:normalize=0[aout]");
    }
  } else if (musicInputIndex !== null) {
    filters.push("[music]anull[aout]");
  } else if (voiceInputIndex !== null) {
    filters.push("[voice]anull[aout]");
  } else {
    filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${duration}[aout]`);
  }

  const args = [
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", `[${videoLabel}]`,
    "-map", "[aout]",
    "-t", duration,
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "19",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-y",
    outputPath,
  ];

  await runFfmpeg(args);
  const { publicUrl } = await storage.saveRender(outputPath, outputName, "video/mp4");
  if (config.STORAGE_BACKEND === "s3") {
    await unlink(outputPath).catch(() => {});
  }
  return { url: publicUrl };
}
