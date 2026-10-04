import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductionBible, ProjectSnapshot, normalizeProductionLocks, normalizeShotLocks, type ReferenceAsset, type DirectorShot, type DirectorPlan } from "@mvs/shared";
import { compileDirectorImageRequest, compileDirectorVideoRequest } from "./directorPrompts.js";
import { useStore } from "./store.js";

import { generateStoryboardImage, regenerateDirectorVideo } from "./directorActions.js";
import { generateTextToImage } from "./api.js";
import { enqueueGeneration } from "./scheduler.js";
vi.mock("./api.js", () => ({ generateTextToImage: vi.fn(), renderTimeline: vi.fn() }));
vi.mock("./scheduler.js", () => ({ enqueueGeneration: vi.fn(() => "job") }));

const references: ReferenceAsset[] = [1, 2, 3].map((slot) => ({ id: `ref-${slot}`, url: `https://example.com/c${slot}.png`, role: "character", locked: true }));
references.push({ id: "car", url: "https://example.com/car.png", role: "vehicle", locked: true }, { id: "prop", url: "https://example.com/prop.png", role: "prop", locked: true });
const bible: ProductionBible = {
  characterLocks: ([1, 2, 3] as const).map((slot) => ({ id: `c${slot}`, slot, name: `Person ${slot}`, notes: `Identity ${slot}`, referenceAssetId: `ref-${slot}`, locked: true })),
  assetLocks: [{ id: "a1", type: "vehicle", name: "Red car", referenceAssetId: "car", locked: true }, { id: "a2", type: "prop", name: "Gold chain", referenceAssetId: "prop", locked: true }],
  characterProfile: "All three people", vehicleProfile: "Red car", negativePrompt: "identity drift", stylePrompt: "Cinematic",
};
const shot: DirectorShot = { id: "s1", clipId: "clip1", start: 0, end: 5, sectionLabel: "verse", role: "Performance", idea: "Night scene", camera: "dolly", framing: "wide", mood: "calm", location: "street", energy: 0.5, hero: false, imageStatus: "idle", imageApproved: false, videoApproved: false, characterIds: ["c2"], assetIds: ["a2"] };
const plan: DirectorPlan = { id: "plan", version: 1, planningBasis: "professional-treatment", vision: "", treatment: { title: "Night", concept: "Night", style: "Film", pacing: "Slow" }, shots: [shot, { ...shot, id: "s2", clipId: "clip2", characterIds: ["c1", "c3"], assetIds: ["a1"] }] };

beforeEach(() => useStore.getState().resetProject());

describe("Director shot locks", () => {
  it("sends only assigned identities and assets into storyboard and video prompts", () => {
    const image = compileDirectorImageRequest(shot, bible, references);
    const video = compileDirectorVideoRequest(shot, bible, references);
    expect(image.referenceImages?.map((ref) => ref.id)).toEqual(["ref-2", "prop"]);
    expect(video.referenceAssetIds).toEqual(["ref-2", "prop"]);
    for (const prompt of [image.promptText, video.promptText]) {
      expect(prompt).toContain("Only these 1 assigned characters");
      expect(prompt).toContain("Person 2");
      expect(prompt).toContain("Gold chain");
      expect(prompt).not.toContain("Person 1");
      expect(prompt).not.toContain("Red car");
      expect(prompt).not.toContain("All three people");
    }
  });
  it("treats explicit empty assignments as people-free coverage with no global reference fallback", () => {
    const image = compileDirectorImageRequest({ ...shot, characterIds: [], assetIds: [] }, bible, references);
    expect(image.mode).toBe("text2img");
    expect(image.referenceImages).toBeUndefined();
    expect(image.promptText).toContain("No characters assigned");
    expect(image.promptText).not.toContain("Red car");
  });
  it("migrates legacy character and vehicle IDs without resurrecting cleared selections", () => {
    const migrated = normalizeProductionLocks({ characterReferenceAssetIds: ["ref-1"], vehicleReferenceAssetIds: ["car"] }, references);
    expect(migrated.characterLocks?.[0]).toMatchObject({ slot: 1, referenceAssetId: "ref-1" });
    expect(migrated.assetLocks?.[0]).toMatchObject({ type: "vehicle", referenceAssetId: "car" });
    expect(normalizeProductionLocks({ characterReferenceAssetIds: [], vehicleReferenceAssetIds: [] }, references).characterLocks).toEqual([]);
    expect(normalizeProductionLocks({ characterLocks: [], assetLocks: [] }, references).assetLocks).toEqual([]);
  });
  it("deduplicates assignments and prunes deleted or inactive locks", () => {
    expect(normalizeShotLocks({ characterIds: ["c1", "c1", "c2", "missing"], assetIds: ["a2", "a2", "missing"] }, { ...bible, characterLocks: bible.characterLocks!.map((lock) => ({ ...lock, locked: lock.id !== "c2" })) })).toEqual({ characterIds: ["c1"], assetIds: ["a2"] });
    expect(ProductionBible.safeParse({ characterLocks: [...bible.characterLocks!, bible.characterLocks![0]] }).success).toBe(false);
  });
  it("fails clearly on missing or excessive references instead of silently dropping them", () => {
    expect(() => compileDirectorImageRequest(shot, bible, [])).toThrow(/missing its reference/);
    const assets = Array.from({ length: 9 }, (_, index) => ({ id: `a${index}`, type: "prop" as const, name: "Prop", referenceAssetId: `p${index}`, locked: true }));
    expect(() => compileDirectorImageRequest({ ...shot, characterIds: [], assetIds: assets.map((lock) => lock.id) }, { ...bible, assetLocks: assets }, references)).toThrow(/at most 8/);
  });
  it("preserves all locks across a treatment revision and round-trips assignments", () => {
    useStore.setState({ productionBible: bible, referenceAssets: references });
    useStore.getState().applyProfessionalDirectorPlan(plan, { characterProfile: "New direction" });
    expect(useStore.getState().productionBible?.characterLocks).toEqual(bible.characterLocks);
    expect(useStore.getState().clips[0]?.referenceAssetIds).toEqual(["ref-2", "prop"]);
    const snapshot = ProjectSnapshot.parse(useStore.getState().getSnapshot());
    useStore.getState().resetProject();
    useStore.getState().restoreSnapshot(snapshot);
    expect(useStore.getState().directorPlan?.shots[0]?.characterIds).toEqual(["c2"]);
    expect(useStore.getState().productionBible?.assetLocks).toEqual(bible.assetLocks);
  });
  it("removing a lock prunes its assignments and clears generated approvals", () => {
    useStore.setState({ productionBible: bible, referenceAssets: references, directorPlan: { ...plan, approvedAt: 1, shots: plan.shots.map((s) => ({ ...s, imageApproved: true, imageStatus: "ready", imageUrl: "old", videoApproved: true })) } });
    useStore.getState().removeReferenceAsset("ref-2");
    expect(useStore.getState().directorPlan?.shots[0]?.characterIds).toEqual([]);
    expect(useStore.getState().directorPlan?.approvedAt).toBeUndefined();
    expect(useStore.getState().directorPlan?.shots[0]?.imageUrl).toBeUndefined();
    expect(useStore.getState().clips[0]?.referenceAssetIds).toEqual(["prop"]);
  });
  it("editing one shot clears its media while preserving other shots", () => {
    useStore.setState({ productionBible: bible, referenceAssets: references });
    useStore.getState().applyProfessionalDirectorPlan(plan, bible);
    useStore.getState().updateClip("clip2", { status: "ready", videoUrl: "keep.mp4" });
    useStore.getState().updateDirectorShot("s1", { characterIds: ["c3"], assetIds: [] });
    expect(useStore.getState().clips[0]?.referenceAssetIds).toEqual(["ref-3"]);
    expect(useStore.getState().clips[1]?.videoUrl).toBe("keep.mp4");
  });
});


describe("Director generation handoff", () => {
  it("uses the approved frame and identical shot assignment in the Agnes job", () => {
    const readyShot = { ...shot, imageStatus: "ready" as const, imageUrl: "https://example.com/approved.png", imageApproved: true };
    useStore.setState({ productionBible: bible, referenceAssets: references });
    useStore.getState().applyProfessionalDirectorPlan({ ...plan, approvedAt: 1, shots: [readyShot] }, bible);
    regenerateDirectorVideo(shot.id);
    expect(enqueueGeneration).toHaveBeenCalledWith(expect.objectContaining({ seedImageUrl: readyShot.imageUrl, prompt: expect.stringContaining("Person 2") }));
    expect(useStore.getState().clips[0]?.referenceAssetIds).toEqual(["ref-2", "prop"]);
    expect(useStore.getState().clips[0]?.prompt).not.toContain("Person 1");
  });
  it("discards an in-flight storyboard response after assignments change", async () => {
    let complete!: (value: any) => void;
    vi.mocked(generateTextToImage).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    useStore.setState({ productionBible: bible, referenceAssets: references });
    useStore.getState().applyProfessionalDirectorPlan({ ...plan, approvedAt: 1 }, bible);
    const pending = generateStoryboardImage(shot.id);
    useStore.getState().updateDirectorShot(shot.id, { characterIds: ["c3"] });
    complete({ url: "https://example.com/stale.png" });
    await expect(pending).rejects.toThrow(/shot changed/);
    expect(useStore.getState().directorPlan?.shots[0]?.imageStatus).toBe("idle");
    expect(useStore.getState().directorPlan?.shots[0]?.imageUrl).toBeUndefined();
  });
});
