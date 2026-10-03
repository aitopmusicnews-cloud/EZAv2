import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { promoDirectorRoutes } from "./promoDirectorRoutes.js";

describe("promo director routes", () => {
  it("rejects invalid requests before any paid call, and strips production notes from speech", async () => {
    const deps = { plan: vi.fn(), speech: vi.fn(async () => ({ url: "https://test.test/narration.mp3", duration: 5 })) };
    const app = Fastify();
    await app.register(promoDirectorRoutes, { deps });
    try {
      const bad = await app.inject({ method: "POST", url: "/api/promo/director/plan", payload: { brief: {} } });
      expect(bad.statusCode).toBe(400); expect(deps.plan).not.toHaveBeenCalled();
      const result = await app.inject({ method: "POST", url: "/api/promo/director/speech", payload: { script: "Hello", voice: "marin", direction: "Calm", speed: 1, productionNotes: "Camera close-up" } });
      expect(result.statusCode).toBe(200);
      expect(deps.speech).toHaveBeenCalledWith({ script: "Hello", voice: "marin", direction: "Calm", speed: 1 });
      expect(result.json().duration).toBe(5);
    } finally { await app.close(); }
  });
});
