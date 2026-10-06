import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { WebsitePromoRequest } from "@mvs/shared";
import { config } from "./config.js";
import { websitePromoService } from "./websitePromoJobs.js";

export async function websitePromoRoutes(app: FastifyInstance) {
  const params = z.object({ id: z.string().regex(/^website-promo-[a-f0-9-]{36}$/) });
  app.post("/api/promo/produce", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = WebsitePromoRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid promo request." });
    if (body.data.shots.length < body.data.draft.scenes.length && !config.AGNES_API_KEY) return reply.code(503).send({ error: "Video generation is not configured. Set AGNES_API_KEY on the server." });
    if (!(config.AZURE_OPENAI_TTS_API_KEY || config.AZURE_OPENAI_MAIN_API_KEY)) return reply.code(503).send({ error: "Narration is not configured. Set the Azure TTS resource key on the server." });
    return reply.code(202).send(await websitePromoService.start(body.data));
  });
  app.get("/api/promo/produce/:id", async (req, reply) => {
    const parsed = params.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid promo job." });
    const job = await websitePromoService.get(parsed.data.id);
    return job ? reply.send(job) : reply.code(404).send({ error: "Promo job is no longer available on this server." });
  });
  app.post("/api/promo/produce/:id/resume", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = params.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid promo job." });
    const job = await websitePromoService.resume(parsed.data.id);
    return job ? reply.send(job) : reply.code(404).send({ error: "Promo job is no longer available on this server." });
  });
}
