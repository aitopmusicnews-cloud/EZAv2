import { describe, expect, it } from "vitest";
import type { LyricDocument } from "@mvs/shared";
import { alignOfficialLyrics, reconcileAccurateTextWithTiming } from "./lyricAlignment.js";

describe("dual-pass lyric reconciliation", () => {
  it("uses accurate wording while preserving monotonic timing", () => {
    const doc = reconcileAccurateTextWithTiming(
      "I know where I'm going",
      [
        { text: "I", start: 1.0, end: 1.2 },
        { text: "no", start: 1.2, end: 1.5 },
        { text: "where", start: 1.5, end: 1.9 },
        { text: "im", start: 1.9, end: 2.1 },
        { text: "going", start: 2.1, end: 2.6 },
      ],
      [{ start: 1.0, end: 2.6, text: "I no where im going" }],
    );
    expect(doc.rawText).toBe("I know where I'm going");
    expect(doc.words?.[0]?.start).toBe(1.0);
    expect(doc.words?.at(-1)?.end).toBe(2.6);
    expect(doc.segments[0]?.text).toContain("know");
  });
});

describe("official lyrics alignment", () => {
  const draft: LyricDocument = {
    source: "transcription",
    rawText: "first known line last known line",
    words: [
      { text: "first", start: 1.0, end: 1.2 },
      { text: "known", start: 1.2, end: 1.4 },
      { text: "line", start: 1.4, end: 1.8 },
      { text: "last", start: 4.0, end: 4.2 },
      { text: "known", start: 4.2, end: 4.4 },
      { text: "line", start: 4.4, end: 4.8 },
    ],
    segments: [
      { id: "d1", start: 1, end: 1.8, text: "first known line", source: "transcription" },
      { id: "d2", start: 4, end: 4.8, text: "last known line", source: "transcription" },
    ],
  };

  it("uses official wording while preserving approximate line timing", () => {
    const aligned = alignOfficialLyrics(draft, "first known line\nlast known line");
    expect(aligned.source).toBe("hybrid");
    expect(aligned.segments).toHaveLength(2);
    expect(aligned.segments[0]!.start).toBeLessThan(aligned.segments[1]!.start);
    expect(aligned.segments.every((segment) => segment.source === "official-aligned")).toBe(true);
  });

  it("interpolates a fully unmatched official line between matched neighbors", () => {
    const aligned = alignOfficialLyrics(draft, "first known line\nbrand new words\nlast known line");
    expect(aligned.segments[1]!.start).toBeGreaterThanOrEqual(aligned.segments[0]!.end);
    expect(aligned.segments[1]!.end).toBeLessThanOrEqual(aligned.segments[2]!.start);
  });
});
