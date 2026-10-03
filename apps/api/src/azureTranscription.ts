import type { LyricDocument } from "@mvs/shared";
import { config } from "./config.js";
import {
  reconcileAccurateTextWithTiming,
  type ProviderTimedSegment,
  type ProviderTimedWord,
} from "./lyricAlignment.js";

export interface TranscriptionProvider {
  transcribe(input: { buffer: Buffer; filename: string; mimeType: string }): Promise<LyricDocument>;
}

type ProviderOptions = {
  apiKey?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
};

type AzureTimingResponse = {
  text?: string;
  language?: string;
  words?: Array<{ word?: string; text?: string; start?: number; end?: number }>;
  segments?: Array<{ text?: string; start?: number; end?: number }>;
};

export function resolveAzureTranscriptionApiKey(transcriptionKey?: string, mainKey?: string): string {
  return transcriptionKey?.trim() || mainKey?.trim() || "";
}

async function safeProviderError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
  } catch {}
  return text.slice(0, 500) || response.statusText;
}

export class AzureTranscriptionProvider implements TranscriptionProvider {
  private apiKey: string;
  private endpoint: string;
  private fetchImpl: typeof fetch;

  constructor(options: ProviderOptions = {}) {
    this.apiKey = options.apiKey ?? resolveAzureTranscriptionApiKey(
      config.AZURE_OPENAI_TRANSCRIPTION_API_KEY,
      config.AZURE_OPENAI_MAIN_API_KEY,
    );
    this.endpoint = options.endpoint ?? config.AZURE_OPENAI_TRANSCRIPTION_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async transcribe(input: { buffer: Buffer; filename: string; mimeType: string }): Promise<LyricDocument> {
    if (!this.apiKey || !this.endpoint) {
      throw new Error("Azure automatic lyric transcription is not configured.");
    }

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }), input.filename);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "api-key": this.apiKey },
      body: form,
    });
    if (!response.ok) {
      const detail = await safeProviderError(response);
      if (response.status === 404 && /deployment|resource|not found/i.test(detail)) {
        throw new Error("Azure transcription deployment 'whisper' was not found. Deploy Whisper in the ezvids-resource Azure OpenAI resource with deployment name 'whisper'.");
      }
      throw new Error(`Azure transcription request failed (${response.status}): ${detail}`);
    }

    const timing = await response.json() as AzureTimingResponse;
    const accurateText = timing.text?.trim() || "";
    if (!accurateText) throw new Error("Azure transcription returned no lyric text.");

    const timedWords: ProviderTimedWord[] = (timing.words ?? [])
      .filter((word) => typeof word.start === "number" && typeof word.end === "number" && Boolean(word.word ?? word.text))
      .map((word) => ({ text: String(word.word ?? word.text), start: word.start!, end: word.end! }));
    const timedSegments: ProviderTimedSegment[] = (timing.segments ?? [])
      .filter((segment) => typeof segment.start === "number" && typeof segment.end === "number" && Boolean(segment.text))
      .map((segment) => ({ text: String(segment.text), start: segment.start!, end: segment.end! }));

    if (!timedWords.length && !timedSegments.length) {
      throw new Error("Azure transcription returned text but no timing information.");
    }

    const document = reconcileAccurateTextWithTiming(accurateText, timedWords, timedSegments);
    return { ...document, language: timing.language };
  }
}
