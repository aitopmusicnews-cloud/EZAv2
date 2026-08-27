import { describe, expect, it, vi } from "vitest";
import type { SongUnderstandingRequest } from "@mvs/shared";
import { generateSongUnderstanding } from "./songUnderstanding.js";

const analysis = {
  duration: 12, bpm: 90, key: "C", beats: [1, 2], downbeats: [1], onsets: [], rmsCurve: [0.2, 0.8],
  sections: [{ start: 0, end: 12, label: "section 1" }],
};

function vocalRequest(): SongUnderstandingRequest {
  return {
    vision: "cinematic freedom",
    analysis,
    lyrics: {
      source: "hybrid",
      rawText: "I am leaving tonight",
      approvedAt: 1,
      segments: [{ id: "l1", start: 1, end: 3, text: "I am leaving tonight", source: "official-aligned" }],
    },
  };
}

const validUnderstanding = {
  basis: "lyrics+music",
  primaryTheme: "leaving and reclaiming control",
  secondaryThemes: ["freedom"],
  emotionalArc: ["decision", "release"],
  sections: [{ start: 0, end: 12, sourceLabel: "section 1", inferredRole: "opening section", lyricalPurpose: "states the decision to leave", musicalPurpose: "builds energy", confidence: "medium" }],
  keyLyricMoments: [{ start: 1, end: 3, lyric: "I am leaving tonight", meaning: "a decisive break", visualOpportunity: "show the departure as a turning point", confidence: "high" }],
  repeatedHooks: [], characters: ["speaker"], narrativePerspective: "first person",
  literalImagery: ["leaving"], symbolicImagery: ["departure as freedom"], tensionRelease: ["decision into release"],
  performanceOpportunities: ["close performance on the decisive line"], visualMotifs: ["doorways"], uncertaintyNotes: ["destination is not specified"],
};

describe("generateSongUnderstanding", () => {
  it("parses strict structured output and keeps uncertainty explicit", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      output: [{ content: [{ type: "output_text", text: JSON.stringify(validUnderstanding) }] }],
    }), { status: 200 }));

    const result = await generateSongUnderstanding(vocalRequest(), { apiKey: "test", model: "gpt-5.6", fetchImpl: fetchImpl as typeof fetch });
    expect(result.primaryTheme).toContain("reclaiming");
    expect(result.keyLyricMoments[0]!.lyric).toBe("I am leaving tonight");
    expect(result.uncertaintyNotes).toEqual(["destination is not specified"]);
  });

  it("rejects unapproved vocal lyrics before calling the provider", async () => {
    const request = vocalRequest();
    request.lyrics.approvedAt = undefined;
    const fetchImpl = vi.fn();
    await expect(generateSongUnderstanding(request, { apiKey: "test", model: "gpt-5.6", fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow(/approve lyrics/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts explicit approved instrumental mode", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      output: [{ content: [{ type: "output_text", text: JSON.stringify({ ...validUnderstanding, basis: "instrumental+vision", keyLyricMoments: [], characters: [], narrativePerspective: "instrumental" }) }] }],
    }), { status: 200 }));
    const result = await generateSongUnderstanding({
      analysis, vision: "night drive without a narrative claim", lyrics: { source: "instrumental", rawText: "", segments: [], approvedAt: 1 },
    }, { apiKey: "test", model: "gpt-5.6", fetchImpl: fetchImpl as typeof fetch });
    expect(result.basis).toBe("instrumental+vision");
  });
});
