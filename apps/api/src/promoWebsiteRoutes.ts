import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PromoAdBrief } from "@mvs/shared";
import { importProductPage, createWebsiteAd } from "./promoWebsite.js";

export async function promoWebsiteRoutes(app: FastifyInstance, options: { deps?: { importPage: typeof importProductPage; createAd: typeof createWebsiteAd } } = {}) {
  const deps = options.deps ?? { importPage: importProductPage, createAd: createWebsiteAd };
  app.post("/api/promo/import-website", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({ url: z.string().trim().min(1).max(2048) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Enter a product-page URL." });
    try { return reply.send(await deps.importPage(body.data.url)); }
    catch (error) {
      req.log.warn({ err: error }, "Product page import failed");
      const message = error instanceof Error ? error.message : "Could not read this page.";
      return reply.code(422).send({ error: `${message} You can enter product details manually below.` });
    }
  });
  app.post("/api/promo/website-ad", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = PromoAdBrief.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Enter a product name, at least 30 characters of product details and a call to action, then confirm your review." });
    try { return reply.send(await deps.createAd(body.data)); }
    catch (error) {
      req.log.warn({ err: error }, "Website ad drafting failed");
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not create the ad draft. Please retry." });
    }
  });
}
