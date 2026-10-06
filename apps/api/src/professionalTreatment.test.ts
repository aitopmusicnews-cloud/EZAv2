import { describe, expect, it, vi } from "vitest";
import { generateProfessionalTreatment } from "./professionalTreatment.js";

const analysis = {
  duration: 12,
  bpm: 96,
  key: "C minor",
  beats: [0, 3, 6, 9, 12],
  downbeats: [0, 3, 6, 9, 12],
  onsets: [],
  rmsCurve: [0.2, 0.4, 0.8, 0.5],
  sections: [{ start: 0, end: 12, label: "section 1" }],
};

const understanding = {
  basis: "instrumental+vision" as const,
  primaryTheme: "forward motion",
  secondaryThemes: ["confidence"],
  emotionalArc: ["build", "release"],
  sections: [{
    start: 0,
    end: 12,
    sourceLabel: "section 1",
    inferredRole: "opening movement",
    lyricalPurpose: "No lyrics; instrumental direction only.",
    musicalPurpose: "Build momentum and resolve.",
    confidence: "high" as const,
  }],
  keyLyricMoments: [],
  repeatedHooks: [],
  characters: [],
  narrativePerspective: "instrumental",
  literalImagery: [],
  symbolicImagery: ["forward movement"],
  tensionRelease: ["steady rise into payoff"],
  performanceOpportunities: ["hero performance"],
  visualMotifs: ["night city lights"],
  uncertaintyNotes: [],
  approvedAt: 1,
};

describe("generateProfessionalTreatment", () => {
  it("creates a professional-treatment plan with fixed timing slots using Azure auth", async () => {
    const generated = {
      treatment: {
        title: "Night Motion",
        concept: "A performance-led city-night visual built around momentum.",
        style: "cinematic realism with controlled neon highlights",
        pacing: "measured build with stronger final payoff",
      },
      productionBible: {
        characterProfile: "One consistent lead performer with a distinctive silhouette, hair, build, and screen presence; preserve the same identity across all recurring shots.",
        wardrobeProfile: "Keep one approved performance look across connected shots.",
        locationProfile: "Night city locations with consistent geography.",
        stylePrompt: "Cinematic night performance, premium realism.",
        colorPalette: "Deep blacks with restrained neon accents.",
        continuityPrompt: "Preserve identity, wardrobe, lighting direction and location logic.",
        negativePrompt: "identity drift, duplicate subjects, malformed anatomy, accidental text, logos, watermarks, continuity breaks",
      },
      shots: [0, 1, 2, 3].map((index) => ({
        index,
        role: index === 3 ? "Finale" : "Performance",
        idea: `Specific shot idea ${index + 1}`,
        camera: "slow cinematic push-in",
        framing: index % 2 ? "medium" : "wide",
        mood: "confident and cinematic",
        location: "night city performance world",
        hero: index === 3,
        characterIds: index === 0 ? ["lead"] : [],
        assetIds: index === 0 ? ["car"] : [],
      })),
    };

    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "api-key": "azure-test" });
      const body = JSON.parse(String(init?.body)) as { model: string; input: Array<{ content: Array<{ text: string }> }> };
      expect(body.model).toBe("gpt-4.1-mini");
      const directorPayload = JSON.parse(body.input[1]!.content[0]!.text);
      expect(directorPayload.selectedVisualStyle).toContain("neo-noir");
      expect(directorPayload.directorRequest).toContain("more performance");
      expect(directorPayload.previousProductionBible.characterLocks[0].id).toBe("lead");
      return new Response(JSON.stringify({
        output: [{ content: [{ type: "output_text", text: JSON.stringify(generated) }] }],
      }), { status: 200 });
    });

    const result = await generateProfessionalTreatment(
      {
        analysis,
        understanding,
        vision: "artist performance in a night city",
        stylePrompt: "premium neo-noir with deep blacks and sculpted practical lighting",
        directorRequest: "make the second half more performance-driven",
        previousProductionBible: {
          characterLocks: [{ id: "lead", slot: 1, name: "Artist", referenceAssetId: "lead-image", locked: true }],
          assetLocks: [{ id: "car", type: "vehicle", name: "Red car", referenceAssetId: "car-image", locked: true }],
        },
      },
      {
        endpoint: "https://example.services.ai.azure.com/openai/v1/responses",
        apiKey: "azure-test",
        model: "gpt-4.1-mini",
        fetchImpl: fetchImpl as typeof fetch,
      },
    );

    expect(result.plan.planningBasis).toBe("professional-treatment");
    expect(result.plan.shots).toHaveLength(4);
    expect(result.plan.shots[0]?.characterIds).toEqual(["lead"]);
    expect(result.plan.shots[0]?.assetIds).toEqual(["car"]);
    expect(result.plan.shots[1]?.characterIds).toEqual([]);
    expect(result.productionBible.characterLocks?.[0]?.referenceAssetId).toBe("lead-image");
    expect(result.plan.shots[0]!.start).toBe(0);
    expect(result.plan.shots.at(-1)!.end).toBe(12);
    expect(result.productionBible.characterProfile).toContain("consistent lead performer");
    expect(result.productionBible.negativePrompt).toContain("identity drift");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("refuses to plan from unapproved Song Understanding", async () => {
    const fetchImpl = vi.fn();
    await expect(generateProfessionalTreatment(
      { analysis, understanding: { ...understanding, approvedAt: undefined }, vision: "" },
      { endpoint: "https://example.test", apiKey: "test", fetchImpl: fetchImpl as typeof fetch },
    )).rejects.toThrow(/approve song understanding/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("product promo treatment timing", () => {
  const promo = { kind: "product" as const, productName: "Studio", facts: "A music video editor with reviewed product facts for a realistic promo.", audience: "Creators", casting: "One adult musician", callToAction: "Visit the site", duration: 6, aspectRatio: "9:16" as const, reviewed: true as const };
  it("uses reviewed product data and keeps every shot within the promo while preserving original analysis", async () => {
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      const input = JSON.parse(body.input[1].content[0].text);
      expect(input.promoBrief).toEqual(promo);
      expect(input.song.duration).toBe(6);
      expect(body.input[0].content[0].text).toContain("untrusted DATA");
      expect(body.input[0].content[0].text).toContain("continuous filmed action");
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        treatment: { title: "Studio Promo", concept: "Music-led product film", style: "realism", pacing: "rhythmic" },
        productionBible: {
          characterProfile: "One consistent adult musician",
          wardrobeProfile: "Consistent artist wardrobe",
          locationProfile: "One coherent studio",
          stylePrompt: "cinematic product realism",
          colorPalette: "controlled neutral palette",
          continuityPrompt: "preserve identity, wardrobe and product continuity",
          negativePrompt: "duplicate subjects, robotic motion, identity drift, malformed anatomy, text, logos, watermarks, continuity breaks",
        },
        shots: input.fixedTimingSlots.map((slot: any) => ({ index: slot.index, role: "Product", idea: "The musician moves naturally through the studio", camera: "tracking", framing: "medium", mood: "confident", location: "studio", hero: false, characterIds: [], assetIds: [] })),
      }) }));
    });
    const result = await generateProfessionalTreatment({ analysis, understanding, vision: "", promo }, { endpoint: "https://example.test", apiKey: "test", fetchImpl });
    expect(result.plan.promo).toEqual(promo);
    expect(result.plan.shots[0].start).toBe(0);
    expect(result.plan.shots.at(-1)?.end).toBe(6);
    expect(result.plan.shots.every((shot, i, shots) => shot.end > shot.start && (i === 0 || shot.start === shots[i-1].end))).toBe(true);
    expect(analysis.duration).toBe(12);
  });

  it("creates a music video promo without product fields", async () => {
    const musicPromo = { kind: "music" as const, duration: 6, aspectRatio: "9:16" as const, reviewed: true as const };
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      const input = JSON.parse(body.input[1].content[0].text);
      expect(input.promoBrief).toEqual(musicPromo);
      expect(input.promoBrief.productName).toBeUndefined();
      expect(input.promoBrief.facts).toBeUndefined();
      expect(input.promoBrief.callToAction).toBeUndefined();
      expect(body.input[0].content[0].text).toContain('promoBrief.kind is "music"');
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        treatment: { title: "Song Teaser", concept: "Artist-first teaser cut to the track", style: "cinematic", pacing: "fast" },
        productionBible: {
          characterProfile: "One consistent lead performer",
          wardrobeProfile: "Consistent artist wardrobe",
          locationProfile: "One coherent performance world",
          stylePrompt: "cinematic music video",
          colorPalette: "controlled contrast",
          continuityPrompt: "preserve identity, wardrobe and location continuity",
          negativePrompt: "identity drift, duplicate subjects, malformed anatomy, text, logos, watermarks, continuity breaks",
        },
        shots: input.fixedTimingSlots.map((slot: any) => ({ index: slot.index, role: "Performance", idea: "Artist performance and cinematic story image", camera: "tracking", framing: "medium", mood: "confident", location: "performance world", hero: false, characterIds: [], assetIds: [] })),
      }) }));
    });
    const result = await generateProfessionalTreatment({ analysis, understanding, vision: "artist performance", promo: musicPromo }, { endpoint: "https://example.test", apiKey: "test", fetchImpl });
    expect(result.plan.promo).toEqual(musicPromo);
    expect(result.plan.shots.at(-1)?.end).toBe(6);
  });

  it("rejects unreviewed briefs and promos longer than the music before spending a provider call", async () => {
    const fetchImpl = vi.fn();
    const options = { endpoint: "https://example.test", apiKey: "test", fetchImpl };
    await expect(generateProfessionalTreatment({ analysis, understanding, vision: "", promo: { ...promo, duration: 30 } }, options)).rejects.toThrow(/exceed/);
    await expect(generateProfessionalTreatment({ analysis, understanding, vision: "", promo: { ...promo, reviewed: false } as any }, options)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
