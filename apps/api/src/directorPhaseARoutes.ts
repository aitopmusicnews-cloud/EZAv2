import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AlignOfficialLyricsRequest,
  AudioAnalysis,
  SongUnderstanding,
  SongUnderstandingRequest,
  TranscribeSongRequest,
} from "@mvs/shared";
import { config } from "./config.js";
import { prepareTranscriptionAudio } from "./transcriptionAudio.js";
import { alignOfficialLyrics } from "./lyricAlignment.js";
import { AzureTranscriptionProvider, type TranscriptionProvider } from "./azureTranscription.js";
import { generateSongUnderstanding } from "./songUnderstanding.js";
import { generateProfessionalTreatment } from "./professionalTreatment.js";

export type DirectorPhaseADeps = {
  openAIConfigured: () => boolean;
  transcriptionConfigured?: () => boolean;
  understandingConfigured?: () => boolean;
  prepareAudio: typeof prepareTranscriptionAudio;
  transcriptionProvider: Pick<TranscriptionProvider, "transcribe">;
  alignOfficialLyrics: typeof alignOfficialLyrics;
  generateUnderstanding: typeof generateSongUnderstanding;
  generateTreatment?: typeof generateProfessionalTreatment;
};

export type DirectorPhaseARouteOptions = { deps?: DirectorPhaseADeps };

export function createDefaultDirectorPhaseADeps(): DirectorPhaseADeps {
  return {
    openAIConfigured: () => Boolean(config.OPENAI_API_KEY),
    transcriptionConfigured: () => Boolean(
      config.AZURE_SPEECH_TRANSCRIPTION_ENDPOINT &&
      (config.AZURE_SPEECH_API_KEY || config.AZURE_OPENAI_TRANSCRIPTION_API_KEY || config.AZURE_OPENAI_MAIN_API_KEY)
    ),
    understandingConfigured: () => Boolean(
      (config.AZURE_OPENAI_MAIN_ENDPOINT && config.AZURE_OPENAI_MAIN_API_KEY) || config.OPENAI_API_KEY
    ),
    prepareAudio: prepareTranscriptionAudio,
    transcriptionProvider: new AzureTranscriptionProvider(),
    alignOfficialLyrics,
    generateUnderstanding: generateSongUnderstanding,
    generateTreatment: generateProfessionalTreatment,
  };
}

export async function directorPhaseARoutes(app: FastifyInstance, options: DirectorPhaseARouteOptions = {}): Promise<void> {
  const deps = options.deps ?? createDefaultDirectorPhaseADeps();

  app.post("/api/director/transcribe", { config: { rateLimit: { max: 4, timeWindow: "1 minute" } } }, async (req, reply) => {
    const transcriptionConfigured = deps.transcriptionConfigured ?? deps.openAIConfigured;
    if (!transcriptionConfigured()) {
      return reply.code(503).send({ error: "Azure Speech automatic lyric transcription is not configured. Paste official lyrics or configure the Azure resource key." });
    }
    const parsed = TranscribeSongRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((issue) => issue.message).join("; ") });
    try {
      const audio = await deps.prepareAudio(parsed.data.audioUrl, parsed.data.songId);
      return reply.send(await deps.transcriptionProvider.transcribe(audio));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/trusted storage origin|does not match uploaded song/i.test(message)) {
        return reply.code(400).send({ error: message });
      }
      if (/Azure Speech/i.test(message)) {
        return reply.code(502).send({ error: message });
      }
      throw error;
    }
  });

  app.post("/api/director/align-lyrics", async (req, reply) => {
    const parsed = AlignOfficialLyricsRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((issue) => issue.message).join("; ") });
    try {
      return reply.send(deps.alignOfficialLyrics(parsed.data.draft, parsed.data.officialText));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/director/understand", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
    const understandingConfigured = deps.understandingConfigured ?? deps.openAIConfigured;
    if (!understandingConfigured()) {
      return reply.code(503).send({ error: "Song Understanding is not configured. Configure the Azure OpenAI main deployment or OPENAI_API_KEY." });
    }
    const parsed = SongUnderstandingRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((issue) => issue.message).join("; ") });
    if (!parsed.data.lyrics.approvedAt) return reply.code(400).send({ error: "Approve lyrics before Song Understanding." });
    return reply.send(await deps.generateUnderstanding(parsed.data));
  });

  const ProfessionalTreatmentRequest = z.object({
    analysis: AudioAnalysis,
    understanding: SongUnderstanding,
    vision: z.string().max(4000).default(""),
  });

  app.post("/api/director/treatment", { config: { rateLimit: { max: 4, timeWindow: "1 minute" } } }, async (req, reply) => {
    const understandingConfigured = deps.understandingConfigured ?? deps.openAIConfigured;
    if (!understandingConfigured()) {
      return reply.code(503).send({ error: "Professional Treatment is not configured. Configure the Azure OpenAI main deployment." });
    }
    const parsed = ProfessionalTreatmentRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((issue) => issue.message).join("; ") });
    if (!parsed.data.understanding.approvedAt) {
      return reply.code(400).send({ error: "Approve Song Understanding before generating a treatment." });
    }
    const generateTreatment = deps.generateTreatment ?? generateProfessionalTreatment;
    return reply.send(await generateTreatment(parsed.data));
  });
}
