import type { FastifyInstance } from "fastify";
import {
  AlignOfficialLyricsRequest,
  SongUnderstandingRequest,
  TranscribeSongRequest,
} from "@mvs/shared";
import { config } from "./config.js";
import { prepareTranscriptionAudio } from "./transcriptionAudio.js";
import { alignOfficialLyrics } from "./lyricAlignment.js";
import { OpenAITranscriptionProvider, type TranscriptionProvider } from "./openaiTranscription.js";
import { generateSongUnderstanding } from "./songUnderstanding.js";

export type DirectorPhaseADeps = {
  openAIConfigured: () => boolean;
  prepareAudio: typeof prepareTranscriptionAudio;
  transcriptionProvider: Pick<TranscriptionProvider, "transcribe">;
  alignOfficialLyrics: typeof alignOfficialLyrics;
  generateUnderstanding: typeof generateSongUnderstanding;
};

export type DirectorPhaseARouteOptions = { deps?: DirectorPhaseADeps };

export function createDefaultDirectorPhaseADeps(): DirectorPhaseADeps {
  return {
    openAIConfigured: () => Boolean(config.OPENAI_API_KEY),
    prepareAudio: prepareTranscriptionAudio,
    transcriptionProvider: new OpenAITranscriptionProvider(),
    alignOfficialLyrics,
    generateUnderstanding: generateSongUnderstanding,
  };
}

export async function directorPhaseARoutes(app: FastifyInstance, options: DirectorPhaseARouteOptions = {}): Promise<void> {
  const deps = options.deps ?? createDefaultDirectorPhaseADeps();

  app.post("/api/director/transcribe", { config: { rateLimit: { max: 4, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!deps.openAIConfigured()) {
      return reply.code(503).send({ error: "Automatic lyric transcription is not configured. Paste official lyrics or configure OPENAI_API_KEY." });
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
    if (!deps.openAIConfigured()) {
      return reply.code(503).send({ error: "Song Understanding is not configured. Configure OPENAI_API_KEY." });
    }
    const parsed = SongUnderstandingRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((issue) => issue.message).join("; ") });
    if (!parsed.data.lyrics.approvedAt) return reply.code(400).send({ error: "Approve lyrics before Song Understanding." });
    return reply.send(await deps.generateUnderstanding(parsed.data));
  });
}
