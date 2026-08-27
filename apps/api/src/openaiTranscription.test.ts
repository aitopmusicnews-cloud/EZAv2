import { describe, expect, it, vi } from "vitest";
import { OpenAITranscriptionProvider } from "./openaiTranscription.js";

describe("OpenAITranscriptionProvider", () => {
  it("uses gpt-transcribe for wording and whisper-1 for timed words/segments", async () => {
    const calls: Array<{ url: string; body: FormData }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as FormData;
      calls.push({ url: String(url), body });
      const model = String(body.get("model"));
      if (model === "gpt-transcribe") {
        return new Response(JSON.stringify({ text: "I know where I'm going" }), { status: 200 });
      }
      return new Response(JSON.stringify({
        text: "I no where im going",
        language: "en",
        words: [
          { word: "I", start: 1, end: 1.2 },
          { word: "no", start: 1.2, end: 1.5 },
          { word: "where", start: 1.5, end: 1.9 },
          { word: "im", start: 1.9, end: 2.1 },
          { word: "going", start: 2.1, end: 2.6 },
        ],
        segments: [{ start: 1, end: 2.6, text: "I no where im going" }],
      }), { status: 200 });
    });

    const provider = new OpenAITranscriptionProvider({
      apiKey: "test-key",
      textModel: "gpt-transcribe",
      timingModel: "whisper-1",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await provider.transcribe({
      buffer: Buffer.from("audio"),
      filename: "song.mp3",
      mimeType: "audio/mpeg",
    });

    expect(result.source).toBe("transcription");
    expect(result.rawText).toBe("I know where I'm going");
    expect(calls).toHaveLength(2);
    expect(calls.some((call) => call.body.get("model") === "gpt-transcribe")).toBe(true);
    const timing = calls.find((call) => call.body.get("model") === "whisper-1")!;
    expect(timing.body.get("response_format")).toBe("verbose_json");
    expect(timing.body.getAll("timestamp_granularities[]")).toEqual(["word", "segment"]);
  });
});
