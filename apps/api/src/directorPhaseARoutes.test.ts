import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { directorPhaseARoutes } from "./directorPhaseARoutes.js";

const analysis = {
  duration: 10, bpm: 100, key: "C", beats: [], downbeats: [], onsets: [], rmsCurve: [0.5],
  sections: [{ start: 0, end: 10, label: "section 1" }],
};
const lyrics = {
  source: "transcription" as const,
  rawText: "hello world",
  approvedAt: 1,
  segments: [{ id: "l1", start: 0, end: 2, text: "hello world", source: "transcription" as const }],
};
const understanding = {
  basis: "lyrics+music" as const,
  primaryTheme: "connection", secondaryThemes: [], emotionalArc: ["open"], sections: [], keyLyricMoments: [],
  repeatedHooks: [], characters: [], narrativePerspective: "first person", literalImagery: [], symbolicImagery: [],
  tensionRelease: [], performanceOpportunities: [], visualMotifs: [], uncertaintyNotes: [],
};

function deps(configured = true) {
  return {
    openAIConfigured: () => configured,
    prepareAudio: vi.fn(async () => ({ buffer: Buffer.from("audio"), filename: "song.mp3", mimeType: "audio/mpeg" as const })),
    transcriptionProvider: { transcribe: vi.fn(async () => lyrics) },
    alignOfficialLyrics: vi.fn(() => ({ ...lyrics, source: "hybrid" as const })),
    generateUnderstanding: vi.fn(async () => understanding),
  };
}

describe("directorPhaseARoutes", () => {
  it("returns 503 for automatic transcription when OpenAI is not configured", async () => {
    const app = Fastify();
    await app.register(directorPhaseARoutes, { deps: deps(false) });
    const res = await app.inject({ method: "POST", url: "/api/director/transcribe", payload: { songId: "abc", audioUrl: "https://ezav2.onrender.com/storage/uploads/abc.mp3", duration: 10 } });
    expect(res.statusCode).toBe(503);
  });

  it("aligns valid official lyrics", async () => {
    const app = Fastify();
    const d = deps();
    await app.register(directorPhaseARoutes, { deps: d });
    const res = await app.inject({ method: "POST", url: "/api/director/align-lyrics", payload: { draft: lyrics, officialText: "hello world" } });
    expect(res.statusCode).toBe(200);
    expect(d.alignOfficialLyrics).toHaveBeenCalledOnce();
  });

  it("rejects understanding when lyrics are not approved", async () => {
    const app = Fastify();
    await app.register(directorPhaseARoutes, { deps: deps() });
    const res = await app.inject({ method: "POST", url: "/api/director/understand", payload: { analysis, vision: "", lyrics: { ...lyrics, approvedAt: undefined } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/approve lyrics/i);
  });

  it("returns schema-valid understanding for approved lyrics", async () => {
    const app = Fastify();
    await app.register(directorPhaseARoutes, { deps: deps() });
    const res = await app.inject({ method: "POST", url: "/api/director/understand", payload: { analysis, vision: "", lyrics } });
    expect(res.statusCode).toBe(200);
    expect(res.json().primaryTheme).toBe("connection");
  });
});
