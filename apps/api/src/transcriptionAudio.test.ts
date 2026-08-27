import { describe, expect, it } from "vitest";
import { assertSongUrlMatchesId } from "./transcriptionAudio.js";

describe("transcription audio safety", () => {
  it("accepts the configured storage origin and matching content-addressed id", () => {
    expect(() => assertSongUrlMatchesId(
      "http://localhost:3001/storage/uploads/abc123.mp3",
      "abc123",
    )).not.toThrow();
  });

  it("rejects an unrelated host or filename", () => {
    expect(() => assertSongUrlMatchesId(
      "https://example.com/storage/uploads/abc123.mp3",
      "abc123",
    )).toThrow(/trusted storage origin/i);

    expect(() => assertSongUrlMatchesId(
      "http://localhost:3001/storage/uploads/not-the-song.mp3",
      "abc123",
    )).toThrow(/does not match uploaded song/i);
  });
});
