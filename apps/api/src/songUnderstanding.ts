import { SongUnderstanding, type SongUnderstandingRequest } from "@mvs/shared";
import { config } from "./config.js";

const SYSTEM_PROMPT = `You are BeatSync's professional music-video song analyst. Your job is to build a semantic foundation for a director, not to invent a music video yet.

Rules:
- Never infer lyrical meaning, characters, relationships, metaphors, or story facts from BPM, loudness, energy, or generic section labels alone.
- Distinguish literal lyric content from interpretation. Put uncertain interpretations in uncertaintyNotes and lower the relevant confidence.
- Key lyric moments must quote only lyric text supplied by the user and must use the supplied lyric timings.
- Generic audio labels such as "section 1" are timing evidence, not proof that a region is a verse, chorus, bridge, or hook. If you infer a musical role, state it as inferred and set confidence honestly.
- Musical analysis may support pacing, tension/release, dynamics, and performance intensity.
- Lyric segment artist labels are authoritative performer metadata. Preserve separate artists/features instead of flattening every verse into one performer.
- Populate vocalistSections from labeled lyric segments. Never guess a named artist from lyric content, genre, or timing when the lyric metadata does not identify the vocalist.
- For instrumental mode, base interpretation on musical structure plus the user's stated vision and set basis to "instrumental+vision". Do not invent lyrics.
- Be specific enough to guide a professional treatment while remaining faithful to the source material.`;

const STRING_ARRAY = { type: "array", items: { type: "string" } } as const;
const CONFIDENCE = { type: "string", enum: ["high", "medium", "low"] } as const;

const SONG_UNDERSTANDING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "basis", "primaryTheme", "secondaryThemes", "emotionalArc", "sections", "vocalistSections", "keyLyricMoments",
    "repeatedHooks", "characters", "narrativePerspective", "literalImagery", "symbolicImagery",
    "tensionRelease", "performanceOpportunities", "visualMotifs", "uncertaintyNotes",
  ],
  properties: {
    basis: { type: "string", enum: ["lyrics+music", "instrumental+vision"] },
    primaryTheme: { type: "string" },
    secondaryThemes: STRING_ARRAY,
    emotionalArc: STRING_ARRAY,
    sections: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["start", "end", "sourceLabel", "inferredRole", "lyricalPurpose", "musicalPurpose", "confidence"],
        properties: {
          start: { type: "number" }, end: { type: "number" }, sourceLabel: { type: "string" },
          inferredRole: { type: "string" }, lyricalPurpose: { type: "string" }, musicalPurpose: { type: "string" }, confidence: CONFIDENCE,
        },
      },
    },
    vocalistSections: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["start", "end", "artist", "role", "confidence"],
        properties: {
          start: { type: "number" }, end: { type: "number" }, artist: { type: "string" },
          role: { type: "string" }, confidence: CONFIDENCE,
        },
      },
    },
    keyLyricMoments: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["start", "end", "lyric", "meaning", "visualOpportunity", "confidence"],
        properties: {
          start: { type: "number" }, end: { type: "number" }, lyric: { type: "string" },
          meaning: { type: "string" }, visualOpportunity: { type: "string" }, confidence: CONFIDENCE,
        },
      },
    },
    repeatedHooks: STRING_ARRAY,
    characters: STRING_ARRAY,
    narrativePerspective: { type: "string" },
    literalImagery: STRING_ARRAY,
    symbolicImagery: STRING_ARRAY,
    tensionRelease: STRING_ARRAY,
    performanceOpportunities: STRING_ARRAY,
    visualMotifs: STRING_ARRAY,
    uncertaintyNotes: STRING_ARRAY,
  },
} as const;

type Options = { apiKey?: string; model?: string; endpoint?: string; fetchImpl?: typeof fetch };

async function safeProviderError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
  } catch {}
  return text.slice(0, 500) || response.statusText;
}

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.trim()) return direct;
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const typed = part as { type?: unknown; text?: unknown };
      if (typed.type === "output_text" && typeof typed.text === "string" && typed.text.trim()) return typed.text;
    }
  }
  return null;
}

function normalizedText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function groundedVocalistSections(request: SongUnderstandingRequest, sections: SongUnderstanding["sections"]): SongUnderstanding["vocalistSections"] {
  const labeled = request.lyrics.segments
    .filter((segment) => Boolean(segment.artist?.trim()) && segment.end >= segment.start)
    .map((segment) => ({ start: segment.start, end: segment.end, artist: segment.artist!.trim() }))
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number; artist: string }> = [];
  for (const item of labeled) {
    const previous = merged.at(-1);
    if (previous && normalizedText(previous.artist) === normalizedText(item.artist) && item.start - previous.end <= 1.5) {
      previous.end = Math.max(previous.end, item.end);
    } else {
      merged.push({ ...item });
    }
  }

  return merged.map((item) => {
    const midpoint = (item.start + item.end) / 2;
    const section = sections.find((candidate) => midpoint >= candidate.start && midpoint <= candidate.end)
      ?? sections.find((candidate) => item.start < candidate.end && item.end > candidate.start);
    return {
      ...item,
      role: section?.inferredRole ?? "vocal section",
      confidence: "high" as const,
    };
  });
}

export async function generateSongUnderstanding(
  request: SongUnderstandingRequest,
  options: Options = {},
): Promise<SongUnderstanding> {
  if (!request.lyrics.approvedAt) throw new Error("Approve lyrics before Song Understanding.");
  const azureEndpoint = options.endpoint ?? config.AZURE_OPENAI_MAIN_ENDPOINT;
  const azureApiKey = options.apiKey ?? config.AZURE_OPENAI_MAIN_API_KEY;
  const useAzure = Boolean(azureEndpoint && azureApiKey);
  const apiKey = useAzure ? azureApiKey! : (options.apiKey ?? config.OPENAI_API_KEY ?? "");
  if (!apiKey) throw new Error("Song Understanding is not configured.");
  const model = options.model ?? (useAzure ? config.AZURE_OPENAI_MAIN_DEPLOYMENT : config.SONG_UNDERSTANDING_MODEL);
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = useAzure ? azureEndpoint! : "https://api.openai.com/v1/responses";

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: useAzure
      ? { "api-key": apiKey, "content-type": "application/json" }
      : { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        { role: "user", content: [{ type: "input_text", text: JSON.stringify({ lyrics: request.lyrics, analysis: request.analysis, vision: request.vision }) }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "song_understanding",
          strict: true,
          schema: SONG_UNDERSTANDING_JSON_SCHEMA,
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`Song Understanding request failed (${response.status}): ${await safeProviderError(response)}`);
  const payload = await response.json() as unknown;
  const outputText = extractOutputText(payload);
  if (!outputText) throw new Error("Song Understanding provider returned no structured output.");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(outputText);
  } catch {
    throw new Error("Song Understanding provider returned invalid JSON.");
  }
  let result = SongUnderstanding.parse(parsedJson);
  result = SongUnderstanding.parse({
    ...result,
    vocalistSections: groundedVocalistSections(request, result.sections),
  });
  const expectedBasis = request.lyrics.source === "instrumental" ? "instrumental+vision" : "lyrics+music";
  if (result.basis !== expectedBasis) throw new Error(`Song Understanding basis mismatch: expected ${expectedBasis}.`);

  if (expectedBasis === "lyrics+music") {
    const source = normalizedText(request.lyrics.rawText);
    const groundedMoments = result.keyLyricMoments.filter((moment) => {
      const quote = normalizedText(moment.lyric);
      return Boolean(quote) && source.includes(quote);
    });
    if (groundedMoments.length !== result.keyLyricMoments.length) {
      return SongUnderstanding.parse({
        ...result,
        keyLyricMoments: groundedMoments,
        uncertaintyNotes: [
          ...result.uncertaintyNotes,
          "One or more model-selected lyric moments were omitted because the quoted text could not be matched to the approved lyrics.",
        ],
      });
    }
  } else if (result.keyLyricMoments.length) {
    throw new Error("Instrumental Song Understanding cannot contain lyric moments.");
  }
  return result;
}
