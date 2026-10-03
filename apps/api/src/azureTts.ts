import { config } from "./config.js";
import { saveUpload } from "./storage.js";

const DEFAULT_INSTRUCTIONS =
  "Confident, polished music-industry narrator. Energetic but natural. Clear pronunciation, strong presence, modern promo style, smooth pacing, not robotic, not overly dramatic.";

type SynthesizeOptions = {
  speed?: number;
  fetchImpl?: typeof fetch;
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

export async function synthesizePromoVoiceover(text: string, options: SynthesizeOptions = {}) {
  const endpoint = config.AZURE_OPENAI_TTS_ENDPOINT;
  const apiKey = config.AZURE_OPENAI_TTS_API_KEY;
  if (!endpoint || !apiKey) throw new Error("Azure promo voiceover is not configured.");

  const input = text.trim();
  if (!input) throw new Error("Voiceover script is empty.");
  if (input.length > 4096) throw new Error("Voiceover script must be 4096 characters or fewer.");

  const speed = options.speed ?? 1;
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw new Error("Voiceover speed must be between 0.25 and 4.");
  }

  const response = await (options.fetchImpl ?? fetch)(endpoint, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.AZURE_OPENAI_TTS_DEPLOYMENT,
      voice: config.AZURE_OPENAI_TTS_VOICE,
      input,
      instructions: DEFAULT_INSTRUCTIONS,
      response_format: "mp3",
      speed,
    }),
  });

  if (!response.ok) {
    throw new Error(`Azure TTS request failed (${response.status}): ${await safeProviderError(response)}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("Azure TTS returned empty audio.");
  const saved = await saveUpload(bytes, `azure-${config.AZURE_OPENAI_TTS_VOICE}-voiceover.mp3`, "audio/mpeg");
  return { ...saved, filename: `azure-${config.AZURE_OPENAI_TTS_VOICE}-voiceover.mp3`, voice: config.AZURE_OPENAI_TTS_VOICE };
}
