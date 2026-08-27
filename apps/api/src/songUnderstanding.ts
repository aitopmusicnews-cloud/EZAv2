import { SongUnderstanding, type SongUnderstandingRequest } from "@mvs/shared";
import { config } from "./config.js";

const SYSTEM_PROMPT = `You are BeatSync's professional music-video song analyst. Your job is to build a semantic foundation for a director, not to invent a music video yet.

Rules:
- Never infer lyrical meaning, characters, relationships, metaphors, or story facts from BPM, loudness, energy, or generic section labels alone.
- Distinguish literal lyric content from interpretation. Put uncertain interpretations in uncertaintyNotes and lower the relevant confidence.
- Key lyric moments must quote only lyric text supplied by the user and must use the supplied lyric timings.
- Generic audio labels such as "section 1" are timing evidence, not proof that a region is a verse, chorus, bridge, or hook. If you infer a musical role, state it as inferred and set confidence honestly.
- Musical analysis may support pacing, tension/release, dynamics, and performance intensity.
- For instrumental mode, base interpretation on musical structure plus the user's stated vision and set basis to "instrumental+vision". Do not invent lyrics.
- Be specific enough to guide a professional treatment while remaining faithful to the source material.`;

const STRING_ARRAY = { type: "array", items: { type: "string" } } as const;
const CONFIDENCE = { type: "string", enum: ["high", "medium", "low"] } as const;

const SONG_UNDERSTANDING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "basis", "primaryTheme", "secondaryThemes", "emotionalArc", "sections", "keyLyricMoments",
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

type Options = { apiKey?: string; model?: string; fetchImpl?: typeof fetch };

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
  return value.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
}

export async function generateSongUnderstanding(
  request: SongUnderstandingRequest,
  options: Options = {},
): Promise<SongUnderstanding> {
  if (!request.lyrics.approvedAt) throw new Error("Approve lyrics before Song Understanding.");
  const apiKey = options.apiKey ?? config.OPENAI_API_KEY ?? "";
  if (!apiKey) throw new Error("Song Understanding is not configured.");
  const model = options.model ?? config.SONG_UNDERSTANDING_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
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
  const result = SongUnderstanding.parse(parsedJson);
  const expectedBasis = request.lyrics.source === "instrumental" ? "instrumental+vision" : "lyrics+music";
  if (result.basis !== expectedBasis) throw new Error(`Song Understanding basis mismatch: expected ${expectedBasis}.`);

  if (expectedBasis === "lyrics+music") {
    const source = normalizedText(request.lyrics.rawText);
    for (const moment of result.keyLyricMoments) {
      if (!source.includes(normalizedText(moment.lyric))) {
        throw new Error(`Song Understanding quoted lyric text that is not present in the approved lyrics: ${moment.lyric}`);
      }
    }
  } else if (result.keyLyricMoments.length) {
    throw new Error("Instrumental Song Understanding cannot contain lyric moments.");
  }
  return result;
}
