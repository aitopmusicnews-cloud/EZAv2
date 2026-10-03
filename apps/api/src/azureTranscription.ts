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

type SpeechWord = {
  text?: string;
  offsetMilliseconds?: number;
  durationMilliseconds?: number;
};

type SpeechPhrase = {
  text?: string;
  offsetMilliseconds?: number;
  durationMilliseconds?: number;
  locale?: string;
  words?: SpeechWord[];
};

type AzureSpeechResponse = {
  combinedPhrases?: Array<{ text?: string }>;
  phrases?: SpeechPhrase[];
};

export function resolveAzureTranscriptionApiKey(
  speechKey?: string,
  transcriptionKey?: string,
  mainKey?: string,
): string {
  return speechKey?.trim() || transcriptionKey?.trim() || mainKey?.trim() || "";
}

async function safeProviderError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string; code?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
  } catch {}
  return text.slice(0, 500) || response.statusText;
}

export class AzureTranscriptionProvider implements TranscriptionProvider {
  private apiKey: string;
  private endpoint: string;
  private fetchImpl: typeof fetch;

  constructor(options: ProviderOptions = {}) {
    this.apiKey = options.apiKey ?? resolveAzureTranscriptionApiKey(
      config.AZURE_SPEECH_API_KEY,
      config.AZURE_OPENAI_TRANSCRIPTION_API_KEY,
      config.AZURE_OPENAI_MAIN_API_KEY,
    );
    this.endpoint = options.endpoint ?? config.AZURE_SPEECH_TRANSCRIPTION_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async transcribe(input: { buffer: Buffer; filename: string; mimeType: string }): Promise<LyricDocument> {
    if (!this.apiKey || !this.endpoint) {
      throw new Error("Azure Speech automatic lyric transcription is not configured.");
    }

    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }), input.filename);
    form.append("definition", JSON.stringify({ locales: [] }));

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": this.apiKey },
      body: form,
    });

    if (!response.ok) {
      const detail = await safeProviderError(response);
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Azure Speech transcription authentication failed (${response.status}). Verify ezvids-resource is a Speech or multi-service Foundry resource and that its resource key is configured. ${detail}`);
      }
      if (response.status === 404) {
        throw new Error(`Azure Speech fast transcription endpoint was not found for ezvids-resource. ${detail}`);
      }
      throw new Error(`Azure Speech transcription request failed (${response.status}): ${detail}`);
    }

    const result = await response.json() as AzureSpeechResponse;
    const phrases = result.phrases ?? [];
    const accurateText = (result.combinedPhrases ?? [])
      .map((phrase) => phrase.text?.trim())
      .filter(Boolean)
      .join("\n")
      .trim() || phrases.map((phrase) => phrase.text?.trim()).filter(Boolean).join("\n").trim();

    if (!accurateText) throw new Error("Azure Speech transcription returned no lyric text.");

    const timedWords: ProviderTimedWord[] = phrases.flatMap((phrase) =>
      (phrase.words ?? [])
        .filter((word) =>
          typeof word.offsetMilliseconds === "number" &&
          typeof word.durationMilliseconds === "number" &&
          Boolean(word.text),
        )
        .map((word) => ({
          text: String(word.text),
          start: word.offsetMilliseconds! / 1000,
          end: (word.offsetMilliseconds! + word.durationMilliseconds!) / 1000,
        })),
    );

    const timedSegments: ProviderTimedSegment[] = phrases
      .filter((phrase) =>
        typeof phrase.offsetMilliseconds === "number" &&
        typeof phrase.durationMilliseconds === "number" &&
        Boolean(phrase.text),
      )
      .map((phrase) => ({
        text: String(phrase.text),
        start: phrase.offsetMilliseconds! / 1000,
        end: (phrase.offsetMilliseconds! + phrase.durationMilliseconds!) / 1000,
      }));

    if (!timedWords.length && !timedSegments.length) {
      throw new Error("Azure Speech transcription returned text but no timing information.");
    }

    const document = reconcileAccurateTextWithTiming(accurateText, timedWords, timedSegments);
    return { ...document, language: phrases.find((phrase) => phrase.locale)?.locale };
  }
}
