import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "ezav2-promo-test-"));
process.env.STORAGE_DIR = dir;
process.env.STORAGE_BACKEND = "local";
process.env.PUBLIC_BASE_URL = "http://localhost:3001";
const ffmpeg = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { maxBuffer: 8 * 1024 * 1024 });
try {
  const { renderPromo } = await import("../apps/api/dist/promo_render.js");
  const { probeDuration } = await import("../apps/api/dist/ffmpeg.js");
  const image = join(dir, "uploads", "image.png");
  const music = join(dir, "uploads", "music.wav");
  const voice = join(dir, "uploads", "voice.wav");
  ffmpeg(["-f", "lavfi", "-i", "color=c=blue:s=160x240", "-frames:v", "1", "-threads", "1", image]);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=220:duration=2", music]);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=880:duration=1", voice]);
  const url = (file) => `http://localhost:3001/storage/uploads/${file}`;
  const request = { projectId: "mix-test", duration: 2, aspectRatio: "9:16", scenes: [{ url: url("image.png"), kind: "image", duration: 2, motion: "static", fit: "contain" }],
    musicUrl: url("music.wav"), voiceoverUrl: url("voice.wav"), musicVolume: 0.28, voiceoverVolume: 1, duckMusic: true };
  await renderPromo(request);
  const output = join(dir, "renders", "mix-test-promo.mp4");
  assert.ok(Math.abs(await probeDuration(output) - 2) < 0.2);
  const pcm = ffmpeg(["-i", output, "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"]);
  function amplitude(frequency, start, end) {
    let re = 0, im = 0;
    const lo = Math.floor(start * 8000), hi = Math.floor(end * 8000);
    for (let i = lo; i < hi; i++) {
      const value = pcm.readFloatLE(i * 4), phase = 2 * Math.PI * frequency * i / 8000;
      re += value * Math.cos(phase); im += value * Math.sin(phase);
    }
    return 2 * Math.hypot(re, im) / (hi - lo);
  }
  assert.ok(amplitude(220, 0.2, 0.8) > 0.001, "music must remain under narration");
  assert.ok(amplitude(880, 0.2, 0.8) > 0.04, "narration must remain audible");
  assert.ok(amplitude(220, 1.5, 1.9) > 0.015, "music must continue after narration");
  await assert.rejects(() => renderPromo({ ...request, duration: 0.5, scenes: [{ ...request.scenes[0], duration: 0.5 }] }), /Voiceover is longer/);
  console.log("PASS: real promo render preserves both audio sources and duration; overlong narration is rejected.");
} finally { await rm(dir, { recursive: true, force: true }); }
