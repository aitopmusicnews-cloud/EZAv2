import { describe, expect, it, vi } from "vitest";
import { AzureTranscriptionProvider, resolveAzureTranscriptionApiKey } from "./azureTranscription.js";

describe("AzureTranscriptionProvider", () => {
  it("uses one Azure Speech fast transcription request for lyric text plus timing", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://ezvids-resource.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15",
      );
      expect(init?.headers).toMatchObject({ "Ocp-Apim-Subscription-Key": "azure-test" });

      const body = init?.body as FormData;
      expect(body.get("audio")).toBeTruthy();
      expect(JSON.parse(String(body.get("definition")))).toEqual({ locales: [] });

      return new Response(JSON.stringify({
        durationMilliseconds: 2600,
        combinedPhrases: [{ text: "I know where I'm going" }],
        phrases: [{
          offsetMilliseconds: 1000,
          durationMilliseconds: 1600,
          text: "I know where I'm going",
          locale: "en-US",
          words: [
            { text: "I", offsetMilliseconds: 1000, durationMilliseconds: 200 },
            { text: "know", offsetMilliseconds: 1200, durationMilliseconds: 300 },
            { text: "where", offsetMilliseconds: 1500, durationMilliseconds: 400 },
            { text: "I'm", offsetMilliseconds: 1900, durationMilliseconds: 200 },
            { text: "going", offsetMilliseconds: 2100, durationMilliseconds: 500 },
          ],
        }],
      }), { status: 200 });
    });

    const provider = new AzureTranscriptionProvider({
      apiKey: "azure-test",
      endpoint: "https://ezvids-resource.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await provider.transcribe({
      buffer: Buffer.from("audio"),
      filename: "song.mp3",
      mimeType: "audio/mpeg",
    });

    expect(result.source).toBe("transcription");
    expect(result.rawText).toBe("I know where I'm going");
    expect(result.language).toBe("en-US");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reuses the main Azure resource key when no transcription-specific key is set", () => {
    expect(resolveAzureTranscriptionApiKey(undefined, undefined, "main-azure-key")).toBe("main-azure-key");
  });

  it("returns a clear Azure Speech auth error", async () => {
    const provider = new AzureTranscriptionProvider({
      apiKey: "azure-test",
      endpoint: "https://ezvids-resource.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15",
      fetchImpl: vi.fn(async () => new Response(
        JSON.stringify({ error: { message: "Access denied." } }),
        { status: 401 },
      )) as typeof fetch,
    });

    await expect(provider.transcribe({
      buffer: Buffer.from("audio"),
      filename: "song.mp3",
      mimeType: "audio/mpeg",
    })).rejects.toThrow(/Azure Speech transcription authentication failed/i);
  });
});
