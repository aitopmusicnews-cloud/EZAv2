import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("promo render regressions", () => {
  it("writes absolute scene paths into the ffmpeg concat manifest", async () => {
    const source = await readFile("apps/api/src/promo_render.ts", "utf8");
    expect(source).toContain('import { join, resolve } from "node:path";');
    expect(source).toContain("scenePaths.map((p) => `file \'${resolve(p)}\'`)");
    expect(source).not.toContain("scenePaths.map((p) => `file \'${p}\'`)");
  });

  it("allows promo renders to poll for 30 minutes by default", async () => {
    const source = await readFile("apps/web/src/lib/api.ts", "utf8");
    expect(source).toContain("const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;");
    expect(source).not.toContain("const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;");
  });

  it("persists and resumes active promo render jobs across refreshes", async () => {
    const source = await readFile("apps/web/src/components/PromoWorkspace.tsx", "utf8");
    expect(source).toContain('const ACTIVE_PROMO_RENDER_KEY = "ezav2-active-promo-render";');
    expect(source).toContain("localStorage.setItem(ACTIVE_PROMO_RENDER_KEY, submitted.renderId);");
    expect(source).toContain("localStorage.getItem(ACTIVE_PROMO_RENDER_KEY)");
    expect(source).toContain("submitPromoRender(req)");
    expect(source).toContain("getPromoRenderJob(renderId)");
    expect(source).not.toContain("renderPromoTimeline(req");
  });
});
