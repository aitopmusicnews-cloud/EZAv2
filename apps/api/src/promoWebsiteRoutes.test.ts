import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { promoWebsiteRoutes } from "./promoWebsiteRoutes.js";

describe("promo website routes", () => {
  it("validates import URLs and requires a reviewed product brief", async () => {
    const app = Fastify();
    const deps = { importPage: vi.fn(), createAd: vi.fn() };
    await app.register(promoWebsiteRoutes, { deps });
    expect((await app.inject({ method: "POST", url: "/api/promo/import-website", payload: { url: "" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/promo/website-ad", payload: { productName: "Test" } })).statusCode).toBe(400);
    expect(deps.importPage).not.toHaveBeenCalled();
    expect(deps.createAd).not.toHaveBeenCalled();
    await app.close();
  });
  it("gives a paste fallback when a website blocks access", async () => {
    const app = Fastify();
    await app.register(promoWebsiteRoutes, { deps: { importPage: vi.fn().mockRejectedValue(new Error("Website returned HTTP 403.")), createAd: vi.fn() } });
    const res = await app.inject({ method: "POST", url: "/api/promo/import-website", payload: { url: "https://example.com" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain("manually");
    await app.close();
  });
});
