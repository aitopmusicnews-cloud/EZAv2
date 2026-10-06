import { describe, expect, it, vi } from "vitest";
import { WebsitePromoRequest, type WebsitePromoJob } from "@mvs/shared";
import { createWebsitePromoService, promoShotPrompt } from "./websitePromoJobs.js";
import { voiceTempoFilters } from "./promo_render.js";

const request = () => WebsitePromoRequest.parse({
  draft: { headline: "A studio for creators", voiceover: "Make your next project. Visit our website.", scenes: [1, 2, 3].map((n) => ({ visual: `A musician creating in a studio, shot ${n}`, onScreenText: "" })), reviewNotes: [] },
  duration: 15, aspectRatio: "9:16", musicUrl: "https://example.com/music.mp3",
});
function harness() {
  const saved = new Map<string, WebsitePromoJob>();
  let count = 0;
  const deps = {
    load: vi.fn(async (id: string) => structuredClone(saved.get(id) ?? null)),
    save: vi.fn(async (job: WebsitePromoJob) => { saved.set(job.id, structuredClone(job)); }),
    voice: vi.fn(async () => ({ publicUrl: "https://example.com/voice.mp3" })),
    startVideo: vi.fn(async () => ({ id: `task-${++count}` })),
    refreshVideo: vi.fn(async (id: string) => ({ status: "completed", video_url: `https://example.com/${id}.mp4` })),
    submitRender: vi.fn(() => ({ id: "render-1" })),
    getRender: vi.fn(() => ({ state: "succeeded", url: "https://example.com/final.mp4" })),
    sleep: vi.fn(async () => {}),
  };
  const service = createWebsitePromoService(deps as any);
  return { service, deps, saved };
}
describe("website to finished promo", () => {
  it("creates moving shots sequentially, narration and a text-free final render with music", async () => {
    const { service, deps } = harness();
    const job = await service.start(request()); await service.idle();
    const result = await service.get(job.id);
    expect(result?.state).toBe("succeeded");
    expect(result?.scenes).toHaveLength(3);
    expect(deps.startVideo).toHaveBeenCalledTimes(3);
    expect(deps.startVideo.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ duration: 5, aspectRatio: "9:16", promptText: expect.stringContaining("shot 1") }));
    expect(deps.submitRender).toHaveBeenCalledWith(expect.objectContaining({ duration: 15, textOverlays: [], fitVoiceover: true, voiceoverUrl: "https://example.com/voice.mp3", musicUrl: request().musicUrl }));
    expect(deps.startVideo.mock.invocationCallOrder[1]).toBeGreaterThan(deps.refreshVideo.mock.invocationCallOrder[0]!);
  });
  it("keeps exact uploaded product visuals and generates only missing shots", async () => {
    const { service, deps } = harness();
    const input = request(); input.shots = [{ url: "https://example.com/product.png", kind: "image" }];
    const job = await service.start(input); await service.idle();
    expect(deps.startVideo).toHaveBeenCalledTimes(2);
    expect((await service.get(job.id))?.scenes[0]?.url).toBe(input.shots[0]?.url);
    expect(deps.submitRender).toHaveBeenCalledWith(expect.objectContaining({ scenes: expect.arrayContaining([expect.objectContaining({ kind: "image", fit: "contain", motion: "static" })]) }));
  });
  it("retries a failed shot without paying again for finished shots or narration", async () => {
    const { service, deps } = harness();
    deps.refreshVideo.mockResolvedValueOnce({ status: "completed", video_url: "https://example.com/one.mp4" }).mockResolvedValueOnce({ status: "failed", error: "Provider busy" } as any);
    const job = await service.start(request()); await service.idle();
    const failed = await service.get(job.id);
    expect(failed?.state).toBe("failed"); expect(failed?.scenes).toHaveLength(1);
    expect(failed?.taskId).toBeUndefined(); expect(deps.submitRender).not.toHaveBeenCalled();
    await service.resume(job.id); await service.idle();
    expect((await service.get(job.id))?.state).toBe("succeeded");
    expect(deps.voice).toHaveBeenCalledTimes(1);
    expect(deps.startVideo).toHaveBeenCalledTimes(4);
  });
  it("resumes an existing task after restart and does not restart successful jobs", async () => {
    const { service, deps, saved } = harness();
    const id = "website-promo-test";
    saved.set(id, { id, request: request(), scenes: [], state: "running", message: "Creating shot", voiceoverUrl: "https://example.com/voice.mp3", taskId: "existing-task" });
    await service.resume(id); await service.idle();
    expect(deps.refreshVideo).toHaveBeenCalledWith("existing-task");
    expect(deps.startVideo).toHaveBeenCalledTimes(2); expect(deps.voice).not.toHaveBeenCalled();
    await service.resume(id); await service.idle();
    expect(deps.submitRender).toHaveBeenCalledTimes(1);
  });
  it("retries assembly without regenerating footage", async () => {
    const { service, deps } = harness();
    deps.getRender.mockReturnValueOnce({ state: "failed", error: "Render interrupted" } as any);
    const job = await service.start(request()); await service.idle();
    expect((await service.get(job.id))?.state).toBe("failed");
    await service.resume(job.id); await service.idle();
    expect((await service.get(job.id))?.state).toBe("succeeded");
    expect(deps.startVideo).toHaveBeenCalledTimes(3); expect(deps.voice).toHaveBeenCalledTimes(1);
  });
  it("enforces valid inputs and protects visual accuracy", () => {
    expect(WebsitePromoRequest.safeParse({ ...request(), duration: 0 }).success).toBe(false);
    expect(promoShotPrompt(request(), 0)).toContain("No added text");
    expect(promoShotPrompt(request(), 0)).toContain("screens out of focus");
    expect(voiceTempoFilters(10, 15)).toBe("");
    expect(voiceTempoFilters(18, 15)).toMatch(/^atempo=1\./);
    expect(voiceTempoFilters(65, 15)).toContain("atempo=2,atempo=2");
  });
});
