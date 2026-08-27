import { describe, expect, it } from "vitest";
import {
  DirectorPlan,
  DirectorStage,
  LyricDocument,
  ProjectSnapshot,
  SongUnderstanding,
} from "./index.js";

describe("Professional Director Phase A contracts", () => {
  it("accepts professional stages and legacy clips for migration", () => {
    for (const stage of ["song", "lyrics", "understanding", "treatment", "plan", "images", "clips", "takes", "edit", "final"]) {
      expect(DirectorStage.parse(stage)).toBe(stage);
    }
  });

  it("accepts timed vocal lyrics and explicit instrumental mode", () => {
    expect(LyricDocument.parse({
      source: "hybrid",
      rawText: "I know where I'm going",
      segments: [{ id: "l1", start: 1, end: 3, text: "I know where I'm going", source: "official-aligned" }],
      words: [{ start: 1, end: 1.2, text: "I" }],
    }).source).toBe("hybrid");

    expect(LyricDocument.parse({ source: "instrumental", rawText: "", segments: [] }).source).toBe("instrumental");
  });

  it("marks historical Director plans as legacy by default", () => {
    const plan = DirectorPlan.parse({
      id: "p1",
      version: 1,
      vision: "",
      treatment: { title: "Legacy", concept: "x", style: "x", pacing: "x" },
      shots: [{
        id: "s1", clipId: "c1", start: 0, end: 3, sectionLabel: "section 1",
        role: "Performance", idea: "x", camera: "wide", framing: "wide",
        mood: "x", location: "x", energy: 0.5, hero: false,
      }],
    });
    expect(plan.planningBasis).toBe("legacy-audio-heuristic");
  });

  it("requires structured uncertainty-aware Song Understanding", () => {
    expect(SongUnderstanding.parse({
      basis: "lyrics+music",
      primaryTheme: "reclaiming control",
      secondaryThemes: ["separation"],
      emotionalArc: ["isolation", "confrontation", "freedom"],
      sections: [],
      keyLyricMoments: [],
      repeatedHooks: [],
      characters: [],
      narrativePerspective: "first person",
      literalImagery: [],
      symbolicImagery: [],
      tensionRelease: [],
      performanceOpportunities: [],
      visualMotifs: [],
      uncertaintyNotes: ["speaker identity is ambiguous"],
    }).primaryTheme).toBe("reclaiming control");
  });

  it("persists Phase A artifacts while parsing historical clips stage", () => {
    const snapshot = ProjectSnapshot.parse({
      projectId: "old",
      directorStage: "clips",
      lyricDocument: { source: "instrumental", rawText: "", segments: [], approvedAt: 1 },
      songUnderstanding: {
        basis: "instrumental+vision",
        primaryTheme: "forward motion",
        secondaryThemes: [], emotionalArc: ["build"], sections: [], keyLyricMoments: [],
        repeatedHooks: [], characters: [], narrativePerspective: "instrumental",
        literalImagery: [], symbolicImagery: [], tensionRelease: [], performanceOpportunities: [],
        visualMotifs: [], uncertaintyNotes: [],
      },
    });
    expect(snapshot.directorStage).toBe("clips");
    expect(snapshot.lyricDocument?.source).toBe("instrumental");
  });
});
