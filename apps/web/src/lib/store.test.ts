import { describe, it, expect, beforeEach } from "vitest";
import type { Clip } from "@mvs/shared";
import { useStore, MIN_CLIP_LEN, MAX_CLIP_LEN } from "./store.js";

function makeClip(over: Partial<Clip> & { id: string; start: number; end: number }): Clip {
  return {
    source: "textToVideo",
    status: "empty",
    ...over,
  };
}

describe("moveBoundary", () => {
  beforeEach(() => {
    useStore.setState({ clips: [], selectedClipId: null });
  });

  it("moves the boundary between two empty clips", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: 5 }),
        makeClip({ id: "b", start: 5, end: 10 }),
      ],
    });
    useStore.getState().moveBoundary("b", 7);
    const [a, b] = useStore.getState().clips;
    expect(a!.end).toBe(7);
    expect(b!.start).toBe(7);
  });

  it("clamps so neither side shrinks below MIN_CLIP_LEN", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: 5 }),
        makeClip({ id: "b", start: 5, end: 10 }),
      ],
    });
    useStore.getState().moveBoundary("b", 99);
    const [a, b] = useStore.getState().clips;
    expect(b!.end - b!.start).toBeGreaterThanOrEqual(MIN_CLIP_LEN);
    expect(a!.end).toBeLessThanOrEqual(10 - MIN_CLIP_LEN);
  });

  it("clamps so neither side grows past MAX_CLIP_LEN", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: 5 }),
        makeClip({ id: "b", start: 5, end: 30 }),
      ],
    });
    useStore.getState().moveBoundary("b", 29);
    const [a] = useStore.getState().clips;
    expect(a!.end - a!.start).toBeLessThanOrEqual(MAX_CLIP_LEN);
  });

  it("invalidates ready Agnes clips when their timeline duration changes", () => {
    useStore.setState({
      clips: [
        makeClip({
          id: "a",
          start: 0,
          end: 5,
          status: "ready",
          source: "textToVideo",
          videoUrl: "https://example.com/a.mp4",
        }),
        makeClip({
          id: "b",
          start: 5,
          end: 10,
          status: "ready",
          source: "imageToVideo",
          videoUrl: "https://example.com/b.mp4",
        }),
      ],
    });
    useStore.getState().moveBoundary("b", 7);
    const [a, b] = useStore.getState().clips;
    expect(a!.videoUrl).toBeUndefined();
    expect(a!.status).toBe("empty");
    expect(b!.videoUrl).toBeUndefined();
    expect(b!.status).toBe("empty");
  });

  it("preserves ready library footage when its timeline slot changes", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: 5, status: "ready", source: "library", videoUrl: "https://example.com/a.mp4" }),
        makeClip({ id: "b", start: 5, end: 10, status: "ready", source: "library", videoUrl: "https://example.com/b.mp4" }),
      ],
    });
    useStore.getState().moveBoundary("b", 7);
    const [a, b] = useStore.getState().clips;
    expect(a!.videoUrl).toBe("https://example.com/a.mp4");
    expect(a!.status).toBe("ready");
    expect(b!.videoUrl).toBe("https://example.com/b.mp4");
    expect(b!.status).toBe("ready");
  });

  it("no-ops when the boundary can't move (lo >= hi)", () => {
    useStore.setState({
      clips: [
        makeClip({ id: "a", start: 0, end: MIN_CLIP_LEN }),
        makeClip({ id: "b", start: MIN_CLIP_LEN, end: MIN_CLIP_LEN * 2 }),
      ],
    });
    const before = useStore.getState().clips;
    useStore.getState().moveBoundary("b", 0.3);
    const after = useStore.getState().clips;
    expect(after).toEqual(before);
  });
});

describe("production control persistence", () => {
  beforeEach(() => {
    useStore.getState().resetProject();
  });

  it("includes the production bible and semantic references in project snapshots", () => {
    useStore.setState({
      productionBible: {
        characterProfile: "same 28-year-old African American woman",
        vehicleProfile: "same glossy black coupe",
        stylePrompt: "cinematic black orange gold",
        negativePrompt: "duplicate protagonist",
        characterReferenceAssetIds: ["char-1"],
        vehicleReferenceAssetIds: ["car-1"],
      },
      referenceAssets: [
        { id: "char-1", url: "https://cdn.example.com/char.png", role: "character", locked: true },
        { id: "car-1", url: "https://cdn.example.com/car.png", role: "vehicle", locked: true },
      ],
    } as any);

    const snapshot = useStore.getState().getSnapshot() as any;
    expect(snapshot.productionBible.characterReferenceAssetIds).toEqual(["char-1"]);
    expect(snapshot.referenceAssets.map((asset: any) => asset.role)).toEqual(["character", "vehicle"]);
  });

  it("restores production controls while historical snapshots receive safe defaults", () => {
    useStore.getState().restoreSnapshot({
      projectId: "proj-1",
      productionBible: {
        characterProfile: "locked lead",
        characterReferenceAssetIds: ["char-1"],
      },
      referenceAssets: [
        { id: "char-1", url: "https://cdn.example.com/char.png", role: "character", locked: true },
      ],
    });
    expect((useStore.getState() as any).productionBible.characterProfile).toBe("locked lead");
    expect((useStore.getState() as any).referenceAssets).toHaveLength(1);

    useStore.getState().restoreSnapshot({ projectId: "historical" });
    expect((useStore.getState() as any).productionBible).toBeNull();
    expect((useStore.getState() as any).referenceAssets).toEqual([]);
  });
});
