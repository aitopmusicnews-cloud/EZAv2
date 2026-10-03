import { describe, expect, it, vi } from "vitest";
import { AzureTranscriptionProvider, resolveAzureTranscriptionApiKey } from "./azureTranscription.js";

describe("AzureTranscriptionProvider", () => {
  it("uses one Azure Whisper request for lyric text plus word/segment timing", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://ezvids-resource.openai.azure.com/openai/deployments/whisper/audio/transcriptions?api-version=2025-04-01-preview",
      );
      expect(init?.headers).toMatchObject({ "api-key": "azure-test" });
      expect((init?.headers as Record<string, string>)?.Authorization).toBeUndefined();

      const body = init?.body as FormData;
      expect(body.get("response_format")).toBe("verbose_json");
      expect(body.getAll("timestamp_granularities[]")).toEqual(["word", "segment"]);

      return new Response(JSON.stringify({
        text: "I know where I'm going",
        language: "en",
        words: [
          { word: "I", start: 1, end: 1.2 },
          { word: "know", start: 1.2, end: 1.5 },
          { word: "where", start: 1.5, end: 1.9 },
          { word: "I'm", start: 1.9, end: 2.1 },
          { word: "going", start: 2.1, end: 2.6 },
        ],
        segments: [{ start: 1, end: 2.6, text: "I know where I'm going" }],
      }), { status: 200 });
    });

    const provider = new AzureTranscriptionProvider({
      apiKey: "azure-test",
      endpoint: "https://ezvids-resource.openai.azure.com/openai/deployments/whisper/audio/transcriptions?api-version=2025-04-01-preview",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await provider.transcribe({
      buffer: Buffer.from("audio"),
      filename: "song.mp3",
      mimeType: "audio/mpeg",
    });

    expect(result.source).toBe("transcription");
    expect(result.rawText).toBe("I know where I'm going");
    expect(result.language).toBe("en");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reuses the main Azure resource key when no transcription-specific key is set", () => {
    expect(resolveAzureTranscriptionApiKey(undefined, "main-azure-key")).toBe("main-azure-key");
  });

  it("returns a clear deployment error instead of exposing provider internals", async () => {
    const provider = new AzureTranscriptionProvider({
      apiKey: "azure-test",
      endpoint: "https://example.openai.azure.com/openai/deployments/whisper/audio/transcriptions?api-version=2025-04-01-preview",
      fetchImpl: vi.fn(async () => new Response(
        JSON.stringify({ error: { message: "The API deployment for this resource does not exist." } }),
        { status: 404 },
      )) as typeof fetch,
    });

    await expect(provider.transcribe({
      buffer: Buffer.from("audio"),
      filename: "song.mp3",
      mimeType: "audio/mpeg",
    })).rejects.toThrow(/deployment 'whisper' was not found/i);
  });
});
