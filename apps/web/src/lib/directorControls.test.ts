import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DirectorWorkspace } from "../components/DirectorWorkspace.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectorPlan, DirectorShot } from "@mvs/shared";
import { resizeDirectorShot } from "./director.js";
import { compileDirectorImageRequest, compileDirectorVideoRequest } from "./directorPrompts.js";
import { useStore } from "./store.js";

const api = vi.hoisted(() => ({ renderTimeline: vi.fn(), generateTextToImage: vi.fn() }));
vi.mock("./api.js", async (original) => ({ ...await original<typeof import("./api.js")>(), ...api }));
import { generateStoryboardImage, renderDirectorFinal } from "./directorActions.js";

const shots: DirectorShot[] = [0, 1, 2].map((i) => ({
  id: `s${i}`, clipId: `c${i}`, start: i * 5, end: (i + 1) * 5,
  sectionLabel: "verse", role: "Performance", idea: "One driver driving a car", camera: "slow tracking",
  framing: "medium", mood: "calm", location: "car cabin", energy: 0.5, hero: false,
  imageStatus: "ready", imageUrl: `https://example.com/${i}.png`, imageApproved: true, videoApproved: true,
}));
const plan: DirectorPlan = { id: "plan", version: 1, planningBasis: "professional-treatment", vision: "", approvedAt: 1,
  treatment: { title: "t", concept: "c", style: "s", pacing: "p" }, shots };
const analysis = { duration: 15, bpm: 90, key: "C", beats: [], downbeats: [], onsets: [], rmsCurve: [], sections: [] };

beforeEach(() => {
  vi.clearAllMocks();
  useStore.getState().resetProject();
  useStore.setState({ analysis, audioUrl: "https://example.com/song.mp3", directorPlan: structuredClone(plan),
    productionBible: { negativePrompt: "watermarks" },
    clips: shots.map((shot) => ({ id: shot.clipId, start: shot.start, end: shot.end, source: "imageToVideo", status: "ready", videoUrl: `https://example.com/${shot.id}.mp4` })),
    directorFinalUrl: "old-render" });
});

describe("Director duration controls", () => {
  it("moves only the shared boundary, including when editing the last shot", () => {
    const changed = resizeDirectorShot(shots, "s0", 7);
    expect(changed.map((s) => [s.start, s.end])).toEqual([[0, 7], [7, 10], [10, 15]]);
    expect(changed[2]).toBe(shots[2]);
    expect(resizeDirectorShot(shots, "s2", 3).map((s) => [s.start, s.end])).toEqual([[0, 5], [5, 12], [12, 15]]);
  });
  it.each([NaN, Infinity, 0, -1, 10])("rejects invalid duration %s", (seconds) => {
    expect(() => resizeDirectorShot(shots, "s0", seconds)).toThrow();
  });
  it("invalidates just the affected takes and keeps unaffected media after reapproval", () => {
    useStore.getState().setDirectorShotDuration("s0", 7);
    const state = useStore.getState();
    expect(state.directorPlan?.approvedAt).toBeUndefined();
    expect(state.directorPlan?.shots.map((s) => s.videoApproved)).toEqual([false, false, true]);
    expect(state.directorPlan?.shots.every((s) => s.imageApproved)).toBe(true);
    expect(state.clips.map((c) => c.status)).toEqual(["empty", "empty", "ready"]);
    expect(state.directorFinalUrl).toBeNull();
    state.approveDirectorPlan();
    expect(useStore.getState().clips[2]?.videoUrl).toBe("https://example.com/s2.mp4");
  });
  it("does not retime an active generation", () => {
    useStore.getState().updateClip("c0", { status: "generating" });
    expect(() => useStore.getState().setDirectorShotDuration("s1", 6)).toThrow(/wait/i);
  });
  it("persists the selected export length and trims the boundary shot", async () => {
    useStore.getState().setDirectorExportDuration(7);
    const snapshot = useStore.getState().getSnapshot();
    useStore.getState().restoreSnapshot(snapshot);
    expect(useStore.getState().directorPlan?.exportDuration).toBe(7);
    api.renderTimeline.mockResolvedValueOnce({ url: "final" });
    await renderDirectorFinal();
    expect(api.renderTimeline.mock.calls[0]![0]).toMatchObject({ duration: 7,
      clips: [{ start: 0, end: 5 }, { start: 5, end: 7 }] });
  });
  it("rejects export lengths beyond the song and unapproved takes", async () => {
    expect(() => useStore.getState().setDirectorExportDuration(20)).toThrow();
    useStore.getState().approveDirectorClip("s1", false);
    await expect(renderDirectorFinal()).rejects.toThrow(/approve all/i);
    expect(api.renderTimeline).not.toHaveBeenCalled();
  });
});

describe("Director visual review", () => {
  it("includes casting, driver contact, distinct identity and natural motion constraints", () => {
    const bible = { characterProfile: "One Black woman with locs", negativePrompt: "watermark" };
    const image = compileDirectorImageRequest(shots[0]!, bible);
    const video = compileDirectorVideoRequest(shots[0]!, bible);
    expect(image.promptText).toContain(bible.characterProfile);
    expect(image.promptText).toContain("one physical instance");
    expect(image.promptText).toContain("hips on the seat");
    expect(video.promptText).toContain("5.00-second take");
    expect(video.promptText).toContain("believable weight");
    expect(video.negativePrompt).toContain("robotic joint motion");
  });
  it("does not add vehicle directions to an unrelated scene", () => {
    const request = compileDirectorVideoRequest({ ...shots[0]!, idea: "One singer on stage", location: "concert hall" });
    expect(request.promptText).not.toContain("driver seated");
  });
  it("revokes approval when replacing an image", () => {
    useStore.getState().setDirectorShotImage("s0", { status: "generating" });
    expect(useStore.getState().directorPlan?.shots[0]?.imageApproved).toBe(false);
    expect(useStore.getState().directorPlan?.shots[0]?.videoApproved).toBe(false);
    expect(useStore.getState().clips[0]?.videoUrl).toBeUndefined();
  });
  it("discards an image returned for an obsolete plan", async () => {
    let resolve!: (value: { url: string }) => void;
    api.generateTextToImage.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = generateStoryboardImage("s0");
    useStore.getState().updateDirectorBible({ characterProfile: "new cast" });
    resolve({ url: "https://example.com/obsolete.png" });
    await expect(pending).rejects.toThrow(/plan changed/i);
    expect(useStore.getState().directorPlan?.shots[0]?.imageStatus).toBe("idle");
    expect(useStore.getState().directorPlan?.shots[0]?.imageUrl).toBeUndefined();
  });
});


describe("Director review controls in the editor", () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    container.remove();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
  });
  it("requires individual image reviews before enabling Continue", async () => {
    useStore.setState({ directorStage: "images", directorPlan: { ...structuredClone(plan), shots: shots.map((shot) => ({ ...shot, imageApproved: false })) } });
    await act(async () => root!.render(createElement(DirectorWorkspace, { onOpenAdvanced: () => {} })));
    const next = () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Continue to Video Takes")!;
    expect(next().disabled).toBe(true);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      await act(async () => checkbox.click());
    }
    expect(next().disabled).toBe(false);
    await act(async () => next().click());
    expect(useStore.getState().directorStage).toBe("takes");
  });
  it("requires every take review and blocks the edit shortcut until approved", async () => {
    useStore.setState({ directorStage: "takes", directorPlan: { ...structuredClone(plan), shots: shots.map((shot) => ({ ...shot, videoApproved: false })) } });
    await act(async () => root!.render(createElement(DirectorWorkspace, { onOpenAdvanced: () => {} })));
    const edit = () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "8. Edit")!;
    expect(edit().disabled).toBe(true);
    for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      await act(async () => checkbox.click());
    }
    expect(edit().disabled).toBe(false);
  });
});
