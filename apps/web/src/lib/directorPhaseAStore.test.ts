import { beforeEach, describe, expect, it } from "vitest";
import type { SongUnderstanding } from "@mvs/shared";
import { useStore } from "./store.js";

const analysis = {
  duration: 10, bpm: 100, key: "C", beats: [], downbeats: [], onsets: [], rmsCurve: [0.5],
  sections: [{ start: 0, end: 10, label: "section 1" }],
};

const understanding: SongUnderstanding = {
  basis: "lyrics+music",
  primaryTheme: "freedom",
  secondaryThemes: [], emotionalArc: ["decision", "release"], sections: [], keyLyricMoments: [],
  repeatedHooks: [], characters: [], narrativePerspective: "first person", literalImagery: [], symbolicImagery: [],
  tensionRelease: [], performanceOpportunities: [], visualMotifs: [], uncertaintyNotes: [],
};

describe("Professional Director Phase A store", () => {
  beforeEach(() => useStore.getState().resetProject());

  it("starts a newly loaded song without fake semantic state", () => {
    useStore.getState().loadSong("song", "https://example.com/song.mp3", analysis, "song.mp3");
    expect(useStore.getState().lyricDocument).toBeNull();
    expect(useStore.getState().songUnderstanding).toBeNull();
    expect(useStore.getState().directorStage).toBe("song");
  });

  it("requires real vocal content before approving lyrics", () => {
    useStore.getState().setLyricDocument({ source: "official", rawText: "", segments: [] });
    useStore.getState().approveLyrics();
    expect(useStore.getState().lyricDocument?.approvedAt).toBeUndefined();
  });

  it("creates Instrumental Mode only through an explicit action", () => {
    useStore.getState().markInstrumental();
    expect(useStore.getState().lyricDocument?.source).toBe("instrumental");
    expect(useStore.getState().lyricDocument?.approvedAt).toBeTypeOf("number");
  });

  it("invalidates understanding and downstream plan approval when lyrics change", () => {
    useStore.setState({
      lyricDocument: { source: "transcription", rawText: "old line", approvedAt: 1, segments: [{ id: "l1", start: 0, end: 2, text: "old line", source: "transcription" }] },
      songUnderstanding: { ...understanding, approvedAt: 1 },
      directorPlan: {
        id: "p", version: 1, planningBasis: "professional-treatment", vision: "", approvedAt: 1,
        treatment: { title: "t", concept: "c", style: "s", pacing: "p" },
        shots: [{ id: "s", clipId: "c", start: 0, end: 2, sectionLabel: "section 1", role: "Performance", idea: "x", camera: "x", framing: "x", mood: "x", location: "x", energy: 0.5, imageStatus: "ready", imageUrl: "img", imageApproved: true, videoApproved: true, hero: false }],
      },
    });
    useStore.getState().updateLyricSegment("l1", "new line");
    expect(useStore.getState().lyricDocument?.approvedAt).toBeUndefined();
    expect(useStore.getState().songUnderstanding).toBeNull();
    expect(useStore.getState().directorPlan?.approvedAt).toBeUndefined();
    expect(useStore.getState().directorPlan?.shots[0]?.imageApproved).toBe(false);
    expect(useStore.getState().directorPlan?.shots[0]?.videoApproved).toBe(false);
  });

  it("persists and restores lyrics and understanding, mapping legacy clips stage to takes", () => {
    useStore.getState().setLyricDocument({ source: "instrumental", rawText: "", segments: [], approvedAt: 1 });
    useStore.getState().setSongUnderstanding({ ...understanding, basis: "instrumental+vision", approvedAt: 2 });
    const snapshot = useStore.getState().getSnapshot();
    expect((snapshot as any).lyricDocument.source).toBe("instrumental");
    expect((snapshot as any).songUnderstanding.primaryTheme).toBe("freedom");

    useStore.getState().restoreSnapshot({ ...snapshot, directorStage: "clips" });
    expect(useStore.getState().directorStage).toBe("takes");
    expect(useStore.getState().lyricDocument?.source).toBe("instrumental");
  });

  it("editing Song Understanding clears its approval and downstream plan approval", () => {
    useStore.setState({ songUnderstanding: { ...understanding, approvedAt: 1 } });
    useStore.getState().updateSongUnderstanding({ primaryTheme: "self-possession" });
    expect(useStore.getState().songUnderstanding?.primaryTheme).toBe("self-possession");
    expect(useStore.getState().songUnderstanding?.approvedAt).toBeUndefined();
  });
});
