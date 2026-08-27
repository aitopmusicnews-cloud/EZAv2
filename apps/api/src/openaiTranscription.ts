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
  textModel?: string;
  timingModel?: string;
  fetchImpl?: typeof fetch;
};

type TextResponse = { text?: string };
type TimingResponse = {
  text?: string;
  language?: string;
  words?: Array<{ word?: string; text?: string; start?: number; end?: number }>;
  segments?: Array<{ text?: string; start?: number; end?: number }>;
};

async function safeProviderError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
  } catch {}
  return text.slice(0, 500) || response.statusText;
}

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  private apiKey: string;
  private textModel: string;
  private timingModel: string;
  private fetchImpl: typeof fetch;

  constructor(options: ProviderOptions = {}) {
    this.apiKey = options.apiKey ?? config.OPENAI_API_KEY ?? "";
    this.textModel = options.textModel ?? config.TRANSCRIPTION_TEXT_MODEL;
    this.timingModel = options.timingModel ?? config.TRANSCRIPTION_TIMING_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async transcribe(input: { buffer: Buffer; filename: string; mimeType: string }): Promise<LyricDocument> {
    if (!this.apiKey) throw new Error("Automatic lyric transcription is not configured.");
    const [wording, timing] = await Promise.all([
      this.requestText(input),
      this.requestTiming(input),
    ]);
    const accurateText = wording.text?.trim() || timing.text?.trim() || "";
    if (!accurateText) throw new Error("Transcription provider returned no lyric text.");

    const timedWords: ProviderTimedWord[] = (timing.words ?? [])
      .filter((word) => typeof word.start === "number" && typeof word.end === "number" && Boolean(word.word ?? word.text))
      .map((word) => ({ text: String(word.word ?? word.text), start: word.start!, end: word.end! }));
    const timedSegments: ProviderTimedSegment[] = (timing.segments ?? [])
      .filter((segment) => typeof segment.start === "number" && typeof segment.end === "number" && Boolean(segment.text))
      .map((segment) => ({ text: String(segment.text), start: segment.start!, end: segment.end! }));
    if (!timedWords.length && !timedSegments.length) {
      throw new Error("Transcription provider returned text but no timing information.");
    }
    const document = reconcileAccurateTextWithTiming(accurateText, timedWords, timedSegments);
    return { ...document, language: timing.language };
  }

  private fileBlob(input: { buffer: Buffer; mimeType: string }): Blob {
    return new Blob([new Uint8Array(input.buffer)], { type: input.mimeType });
  }

  private async requestText(input: { buffer: Buffer; filename: string; mimeType: string }): Promise<TextResponse> {
    const form = new FormData();
    form.append("file", this.fileBlob(input), input.filename);
    form.append("model", this.textModel);
    form.append("response_format", "json");
    const response = await this.fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!response.ok) throw new Error(`Transcription wording request failed (${response.status}): ${await safeProviderError(response)}`);
    return await response.json() as TextResponse;
  }

  private async requestTiming(input: { buffer: Buffer; filename: string; mimeType: string }): Promise<TimingResponse> {
    const form = new FormData();
    form.append("file", this.fileBlob(input), input.filename);
    form.append("model", this.timingModel);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    const response = await this.fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!response.ok) throw new Error(`Transcription timing request failed (${response.status}): ${await safeProviderError(response)}`);
    return await response.json() as TimingResponse;
  }
}
