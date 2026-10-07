import { z } from "zod";

const optionalUrl = z
  .string()
  .transform((v) => (v.trim() === "" ? undefined : v))
  .pipe(z.string().url().optional());

const optionalNonEmpty = z
  .string()
  .transform((v) => (v.trim() === "" ? undefined : v))
  .pipe(z.string().min(1).optional());

const Env = z.object({
  AGNES_API_KEY: optionalNonEmpty.optional(),
  SYNC_API_KEY: optionalNonEmpty.optional(),
  OPENAI_API_KEY: optionalNonEmpty.optional(),
  AZURE_OPENAI_MAIN_ENDPOINT: optionalUrl.optional(),
  AZURE_OPENAI_MAIN_API_KEY: optionalNonEmpty.optional(),
  AZURE_OPENAI_MAIN_DEPLOYMENT: z.string().min(1).default("gpt-4.1-mini"),
  AZURE_OPENAI_TTS_ENDPOINT: z.string().url().default("https://ezvids-resource.openai.azure.com/openai/deployments/gpt-4o-mini-tts/audio/speech?api-version=2025-03-01-preview"),
  AZURE_OPENAI_TTS_API_KEY: optionalNonEmpty.optional(),
  AZURE_OPENAI_TTS_DEPLOYMENT: z.string().min(1).default("gpt-4o-mini-tts"),
  AZURE_OPENAI_TTS_VOICE: z.string().min(1).default("alloy"),
  AZURE_OPENAI_TRANSCRIPTION_ENDPOINT: z.string().url().default("https://ezvids-resource.openai.azure.com/openai/deployments/whisper/audio/transcriptions?api-version=2025-04-01-preview"),
  AZURE_OPENAI_TRANSCRIPTION_API_KEY: optionalNonEmpty.optional(),
  SONG_UNDERSTANDING_MODEL: z.string().min(1).default("gpt-5.6"),
  DIRECTOR_MODEL: z.string().min(1).default("gpt-5.6"),
  PORT: z.coerce.number().default(3001),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3001"),
  // Comma-separated list of allowed CORS origins (or a single URL).
  WEB_ORIGIN: z
    .string()
    .default("http://localhost:5173")
    .refine(
      (v) =>
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .every((s) => /^https?:\/\/[^,\s]+$/.test(s)),
      "WEB_ORIGIN must be a URL or comma-separated list of URLs"
    ),
  STORAGE_DIR: z.string().default("./storage"),
  STORAGE_BACKEND: z.enum(["local", "s3", "azure"]).default("local"),
  S3_BUCKET: optionalNonEmpty.optional(),
  S3_REGION: optionalNonEmpty.optional(),
  /** Override the public URL base for S3 objects (e.g. a CloudFront domain).
   * When unset, virtual-hosted-style S3 URLs are used. */
  S3_PUBLIC_URL_BASE: optionalUrl.optional(),
  AZURE_STORAGE_CONNECTION_STRING: optionalNonEmpty.optional(),
  AZURE_STORAGE_CONTAINER: z.string().min(1).default("ezav2-media"),
  AZURE_STORAGE_PUBLIC_BASE: optionalUrl.optional(),
  /** Directory holding the built SPA (apps/web/dist) to serve from `/`.
   *  In the production Docker image this is set to /app/web; locally it can
   *  stay unset and Vite handles the SPA in dev. */
  WEB_DIST_DIR: optionalNonEmpty.optional(),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("invalid env:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("\ncopy .env.example to .env at the repo root and fill in values.");
  process.exit(1);
}

export const config = parsed.data;

if (!config.AGNES_API_KEY) {
  console.warn(
    "WARN: AGNES_API_KEY is not set. Video and image generation are offline. " +
      "Audio analysis, editing, library, and rendering still work."
  );
}
if (!config.SYNC_API_KEY) {
  console.warn("WARN: SYNC_API_KEY is not set. Manual lip-sync is offline.");
}
if (!config.OPENAI_API_KEY) {
  console.warn("WARN: OPENAI_API_KEY is not set. The legacy direct-OpenAI fallback is disabled; Azure remains the primary AI provider.");
}
if (!(config.AZURE_OPENAI_TRANSCRIPTION_API_KEY || config.AZURE_OPENAI_MAIN_API_KEY)) {
  console.warn("WARN: Azure OpenAI transcription has no resource key. Automatic lyric transcription is offline.");
}
if (!config.AZURE_OPENAI_MAIN_API_KEY || !config.AZURE_OPENAI_MAIN_ENDPOINT) {
  console.warn("WARN: Azure OpenAI main model is not configured. Song Understanding will fall back to OPENAI_API_KEY when available.");
}
if (!(config.AZURE_OPENAI_TTS_API_KEY || config.AZURE_OPENAI_MAIN_API_KEY)) {
  console.warn("WARN: Azure OpenAI TTS has no resource key. Promo voiceover generation is offline.");
}
if (config.STORAGE_BACKEND === "s3") {
  if (!config.S3_BUCKET || !config.S3_REGION) {
    console.error("STORAGE_BACKEND=s3 requires S3_BUCKET and S3_REGION");
    process.exit(1);
  }
} else if (config.STORAGE_BACKEND === "azure") {
  if (!config.AZURE_STORAGE_CONNECTION_STRING) {
    console.error("STORAGE_BACKEND=azure requires AZURE_STORAGE_CONNECTION_STRING");
    process.exit(1);
  }
} else {
  console.warn("STORAGE_BACKEND=local — uploads stored on container disk only (ephemeral).");
}

export type Config = z.infer<typeof Env>;
