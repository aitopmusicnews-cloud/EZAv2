import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { config } from "./config.js";
import { runFfmpeg } from "./ffmpeg.js";
import { assertSafeHost } from "./net.js";

const MAX_TRANSCRIPTION_BYTES = 24 * 1024 * 1024;

function trustedStorageOrigins(): Set<string> {
  const origins = new Set<string>();
  origins.add(new URL(config.PUBLIC_BASE_URL).origin);
  if (config.S3_PUBLIC_URL_BASE) origins.add(new URL(config.S3_PUBLIC_URL_BASE).origin);
  if (config.S3_BUCKET && config.S3_REGION) {
    origins.add(`https://${config.S3_BUCKET}.s3.${config.S3_REGION}.amazonaws.com`);
  }
  return origins;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function assertSongUrlMatchesId(audioUrl: string, songId: string): void {
  const parsed = new URL(audioUrl);
  if (!trustedStorageOrigins().has(parsed.origin)) {
    throw new Error("Song URL is not from a trusted storage origin.");
  }
  const decodedPath = decodeURIComponent(parsed.pathname);
  const filename = decodedPath.split("/").filter(Boolean).at(-1) ?? "";
  const matchesId = filename === songId || filename.startsWith(`${songId}.`) || filename.startsWith(`${songId}-`);
  if (!decodedPath.includes("/uploads/") || !matchesId) {
    throw new Error("Song URL does not match uploaded song id.");
  }
}

export async function prepareTranscriptionAudio(
  audioUrl: string,
  songId: string,
): Promise<{ buffer: Buffer; filename: string; mimeType: "audio/mpeg" }> {
  assertSongUrlMatchesId(audioUrl, songId);
  const parsed = new URL(audioUrl);
  if (!isLoopbackHost(parsed.hostname)) await assertSafeHost(audioUrl);

  const tempPath = join(tmpdir(), `lyrics-${songId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
  try {
    await runFfmpeg([
      "-i", audioUrl,
      "-vn",
      "-ac", "1",
      "-ar", "44100",
      "-c:a", "libmp3lame",
      "-b:a", "96k",
      "-y", tempPath,
    ]);
    const buffer = await readFile(tempPath);
    if (buffer.byteLength > MAX_TRANSCRIPTION_BYTES) {
      throw new Error(`Prepared transcription audio exceeds ${MAX_TRANSCRIPTION_BYTES} bytes.`);
    }
    return { buffer, filename: `${songId}-transcription.mp3`, mimeType: "audio/mpeg" };
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}
