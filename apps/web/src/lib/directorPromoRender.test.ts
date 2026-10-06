import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./store.js";
import { renderDirectorFinal } from "./directorActions.js";
import { renderTimeline } from "./api.js";
vi.mock("./api.js", () => ({ renderTimeline: vi.fn(), generateTextToImage: vi.fn() }));
vi.mock("./scheduler.js", () => ({ enqueueGeneration: vi.fn() }));
beforeEach(() => { useStore.getState().resetProject(); vi.clearAllMocks(); });
describe("Director promo final player handoff", () => {
  it.each([true, false])("renders the saved plan length with original music (promo=%s)", async (isPromo) => {
    const duration = isPromo ? 15 : 90;
    useStore.setState({ audioUrl: "https://example.com/music.mp3", analysis: { duration: 90, bpm: 100, key: "C", beats: [], downbeats: [], onsets: [], rmsCurve: [], sections: [] }, projectId: "test-project", referenceAssets: [{ id: "lead-image", url: "https://example.com/lead.png", role: "character", locked: true }], productionBible: { characterLocks: [{ id: "lead", slot: 1, name: "Artist", referenceAssetId: "lead-image", locked: true }], assetLocks: [] }, directorPlan: {
      id: "plan", version: 1, planningBasis: "professional-treatment", approvedAt: 1, vision: "", treatment: { title: "Test", concept: "Test", style: "Film", pacing: "Fast" },
      ...(isPromo ? { promo: { kind: "music" as const, duration, aspectRatio: "9:16" as const, reviewed: true as const } } : {}),
      shots: [{ id: "shot", clipId: "clip", start: 0, end: duration, sectionLabel: "intro", role: "product", idea: "movement", camera: "tracking", framing: "wide", mood: "warm", location: "studio", energy: 0.5, hero: false, imageStatus: "ready", imageApproved: true, videoApproved: true }],
    }, clips: [{ id: "clip", start: 0, end: duration, source: "imageToVideo", status: "ready", videoUrl: "https://example.com/generated.mp4" } as any] });
    vi.mocked(renderTimeline).mockResolvedValue({ url: "https://example.com/final.mp4" });
    await renderDirectorFinal();
    expect(renderTimeline).toHaveBeenCalledWith(expect.objectContaining({ duration, aspectRatio: isPromo ? "9:16" : "16:9", audioUrl: "https://example.com/music.mp3", clips: [expect.objectContaining({ videoUrl: "https://example.com/generated.mp4" })] }), expect.anything());
    expect(vi.mocked(renderTimeline).mock.calls[0][0].projectId).toMatch(/^test-project-export-/);
    expect(useStore.getState().directorFinalUrl).toBe("https://example.com/final.mp4");
    expect(useStore.getState().directorStage).toBe("final");
    vi.mocked(renderTimeline).mockImplementationOnce(async () => {
      useStore.getState().resetProject();
      return { url: "https://example.com/older-final.mp4" };
    });
    await expect(renderDirectorFinal()).rejects.toThrow(/project changed/);
    expect(useStore.getState().directorFinalUrl).toBeNull();
  });
});