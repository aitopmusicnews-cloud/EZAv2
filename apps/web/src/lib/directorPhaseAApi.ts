import type {
  AlignOfficialLyricsRequest,
  LyricDocument,
  SongUnderstanding,
  SongUnderstandingRequest,
  TranscribeSongRequest,
} from "@mvs/shared";

export class DirectorPhaseAApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DirectorPhaseAApiError";
    this.status = status;
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    let message = text || `Request failed (${res.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {}
    throw new DirectorPhaseAApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export async function transcribeSong(req: TranscribeSongRequest): Promise<LyricDocument> {
  return jsonOrThrow(await fetch("/api/director/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function alignOfficialLyricsApi(req: AlignOfficialLyricsRequest): Promise<LyricDocument> {
  return jsonOrThrow(await fetch("/api/director/align-lyrics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function requestSongUnderstanding(req: SongUnderstandingRequest): Promise<SongUnderstanding> {
  return jsonOrThrow(await fetch("/api/director/understand", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}
