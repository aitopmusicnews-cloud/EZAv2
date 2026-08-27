import { describe, expect, it } from "vitest";
import type { AudioAnalysis, DirectorPlan } from "@mvs/shared";
import { createDirectorPlan } from "./director.js";
import { generateStoryboardImage } from "./directorActions.js";
import { useStore } from "./store.js";

const analysis: AudioAnalysis = {
  duration: 8,
  bpm: 120,
  key: "C",
  beats: [0, 1, 2, 3, 4, 5, 6, 7],
  downbeats: [0, 4],
  onsets: [],
  rmsCurve: [0.4, 0.8],
  sections: [{ start: 0, end: 8, label: "section 1" }],
};

describe("Professional Director legacy safety gate", () => {
  it("stamps the old audio-only planner as legacy", () => {
    expect(createDirectorPlan(analysis, "night city", {}).planningBasis).toBe("legacy-audio-heuristic");
  });

  it("refuses storyboard generation from a legacy plan", async () => {
    const plan = createDirectorPlan(analysis, "night city", {}) as DirectorPlan;
    useStore.setState({
      directorPlan: { ...plan, approvedAt: Date.now() },
      productionBible: { negativePrompt: "watermark" },
    });
    await expect(generateStoryboardImage(plan.shots[0]!.id)).rejects.toThrow(/legacy Director plan/i);
  });
});
