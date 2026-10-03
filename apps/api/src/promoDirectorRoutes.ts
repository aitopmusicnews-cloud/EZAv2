import type { FastifyInstance } from "fastify";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PromoDirectorRequest, PromoSpeechRequest } from "@mvs/shared";
import { generatePromoPlan, generatePromoSpeech } from "./promoDirector.js";
import { storage } from "./storage.js";
import { probeDuration } from "./ffmpeg.js";

export async function savePromoSpeech(request: PromoSpeechRequest) {
  const audio = await generatePromoSpeech(request);
  const folder = await mkdtemp(join(tmpdir(), "ezav2-speech-"));
  try {
    const path = join(folder, "narration.mp3");
    await writeFile(path, audio);
    const duration = await probeDuration(path);
    const saved = await storage.saveUpload(audio, "narration.mp3", "audio/mpeg");
    return { url: saved.publicUrl, duration };
  } finally { await rm(folder, { recursive: true, force: true }); }
}

export async function promoDirectorRoutes(app: FastifyInstance, options: { deps?: {
  plan: typeof generatePromoPlan; speech: typeof savePromoSpeech;
} } = {}) {
  const deps = options.deps ?? { plan: generatePromoPlan, speech: savePromoSpeech };
  app.post("/api/promo/director/plan", { bodyLimit: 64 * 1024, config: { rateLimit: { max: 4, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = PromoDirectorRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Complete the product, audience, facts and call to action; choose 15, 30 or 60 seconds." });
    return deps.plan(parsed.data);
  });
  app.post("/api/promo/director/speech", { bodyLimit: 16 * 1024, config: { rateLimit: { max: 4, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = PromoSpeechRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Use a script of 1–4000 characters, a supported voice and speed between 0.75 and 1.25." });
    return deps.speech(parsed.data);
  });
}
