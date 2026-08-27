import type { LyricDocument, LyricWord } from "@mvs/shared";

export type ProviderTimedWord = { text: string; start: number; end: number };
export type ProviderTimedSegment = { text: string; start: number; end: number };

type Token = { text: string; normalized: string };

function tokenize(text: string): Token[] {
  const matches = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu) ?? [];
  return matches.map((value) => ({
    text: value,
    normalized: value.toLowerCase().replaceAll("’", "'").replace(/[^\p{L}\p{N}']/gu, ""),
  }));
}

function alignTokenIndexes(source: Token[], timed: Token[]): Array<number | null> {
  const rows = source.length + 1;
  const cols = timed.length + 1;
  const cost = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  const op = Array.from({ length: rows }, () => Array<"diag" | "up" | "left" | null>(cols).fill(null));
  for (let i = 1; i < rows; i += 1) { cost[i]![0] = i; op[i]![0] = "up"; }
  for (let j = 1; j < cols; j += 1) { cost[0]![j] = j; op[0]![j] = "left"; }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const substitution = cost[i - 1]![j - 1]! + (source[i - 1]!.normalized === timed[j - 1]!.normalized ? 0 : 1);
      const deletion = cost[i - 1]![j]! + 1;
      const insertion = cost[i]![j - 1]! + 1;
      if (substitution <= deletion && substitution <= insertion) {
        cost[i]![j] = substitution; op[i]![j] = "diag";
      } else if (deletion <= insertion) {
        cost[i]![j] = deletion; op[i]![j] = "up";
      } else {
        cost[i]![j] = insertion; op[i]![j] = "left";
      }
    }
  }

  const mapping = Array<number | null>(source.length).fill(null);
  let i = source.length;
  let j = timed.length;
  while (i > 0 || j > 0) {
    const step = op[i]![j];
    if (step === "diag") {
      mapping[i - 1] = j - 1;
      i -= 1; j -= 1;
    } else if (step === "up") {
      i -= 1;
    } else if (step === "left") {
      j -= 1;
    } else {
      break;
    }
  }
  return mapping;
}

function timedWordsForText(text: string, timedWords: ProviderTimedWord[]): LyricWord[] {
  const source = tokenize(text);
  if (!source.length) return [];
  if (!timedWords.length) return [];
  const timedTokens = timedWords.map((word) => ({ text: word.text, normalized: tokenize(word.text)[0]?.normalized ?? word.text.toLowerCase() }));
  const mapping = alignTokenIndexes(source, timedTokens);
  const result: LyricWord[] = source.map((token, index) => {
    const mapped = mapping[index];
    if (mapped != null && timedWords[mapped]) {
      const word = timedWords[mapped]!;
      return { text: token.text, start: word.start, end: Math.max(word.start, word.end), confidence: token.normalized === timedTokens[mapped]?.normalized ? 0.95 : 0.7 };
    }
    return { text: token.text, start: Number.NaN, end: Number.NaN, confidence: 0.45 };
  });

  for (let index = 0; index < result.length; index += 1) {
    if (Number.isFinite(result[index]!.start)) continue;
    let prev = index - 1;
    while (prev >= 0 && !Number.isFinite(result[prev]!.start)) prev -= 1;
    let next = index + 1;
    while (next < result.length && !Number.isFinite(result[next]!.start)) next += 1;
    const runStart = index;
    let runEnd = index;
    while (runEnd + 1 < result.length && !Number.isFinite(result[runEnd + 1]!.start)) runEnd += 1;
    const count = runEnd - runStart + 1;
    const left = prev >= 0 ? result[prev]!.end : timedWords[0]!.start;
    const right = next < result.length ? result[next]!.start : timedWords.at(-1)!.end;
    const span = Math.max(0, right - left);
    for (let k = 0; k < count; k += 1) {
      const start = left + span * (k / count);
      const end = left + span * ((k + 1) / count);
      result[runStart + k] = { ...result[runStart + k]!, start, end };
    }
    index = runEnd;
  }
  return result;
}

export function reconcileAccurateTextWithTiming(
  accurateText: string,
  timedWords: ProviderTimedWord[],
  timedSegments: ProviderTimedSegment[],
): LyricDocument {
  const words = timedWordsForText(accurateText, timedWords);
  const segments = timedSegments.map((segment, index) => {
    const inside = words.filter((word) => {
      const midpoint = (word.start + word.end) / 2;
      return midpoint >= segment.start && midpoint <= segment.end;
    });
    return {
      id: `transcript-${index + 1}`,
      start: segment.start,
      end: Math.max(segment.start, segment.end),
      text: inside.length ? inside.map((word) => word.text).join(" ") : segment.text.trim(),
      confidence: inside.length ? 0.85 : 0.5,
      source: "transcription" as const,
    };
  });

  if (!segments.length && words.length) {
    segments.push({
      id: "transcript-1",
      start: words[0]!.start,
      end: words.at(-1)!.end,
      text: accurateText.trim(),
      confidence: 0.75,
      source: "transcription",
    });
  }

  return {
    source: "transcription",
    rawText: accurateText.trim(),
    segments,
    words,
  };
}

export function alignOfficialLyrics(draft: LyricDocument, officialText: string): LyricDocument {
  const timedDraftWords = draft.words ?? [];
  if (!timedDraftWords.length) {
    throw new Error("Official lyrics need a timed transcription before automatic alignment.");
  }
  const lines = officialText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error("Official lyrics cannot be empty.");

  const flatText = lines.join(" ");
  const officialWords = timedWordsForText(flatText, timedDraftWords);
  let cursor = 0;
  const lineWordCounts = lines.map((line) => tokenize(line).length);
  const rawRanges = lines.map((line, index) => {
    const count = lineWordCounts[index]!;
    const lineWords = officialWords.slice(cursor, cursor + count);
    cursor += count;
    const finite = lineWords.filter((word) => Number.isFinite(word.start));
    if (finite.length) return { start: finite[0]!.start, end: finite.at(-1)!.end };
    return { start: Number.NaN, end: Number.NaN };
  });

  for (let index = 0; index < rawRanges.length; index += 1) {
    if (Number.isFinite(rawRanges[index]!.start)) continue;
    let runEnd = index;
    while (runEnd + 1 < rawRanges.length && !Number.isFinite(rawRanges[runEnd + 1]!.start)) runEnd += 1;
    let prev = index - 1;
    while (prev >= 0 && !Number.isFinite(rawRanges[prev]!.start)) prev -= 1;
    let next = runEnd + 1;
    while (next < rawRanges.length && !Number.isFinite(rawRanges[next]!.start)) next += 1;
    const left = prev >= 0 ? rawRanges[prev]!.end : timedDraftWords[0]!.start;
    const right = next < rawRanges.length ? rawRanges[next]!.start : timedDraftWords.at(-1)!.end;
    const totalWeight = lineWordCounts.slice(index, runEnd + 1).reduce((sum, value) => sum + Math.max(1, value), 0);
    let offset = left;
    for (let lineIndex = index; lineIndex <= runEnd; lineIndex += 1) {
      const weight = Math.max(1, lineWordCounts[lineIndex]!);
      const width = Math.max(0, right - left) * (weight / totalWeight);
      rawRanges[lineIndex] = { start: offset, end: offset + width };
      offset += width;
    }
    index = runEnd;
  }

  let previousEnd = timedDraftWords[0]!.start;
  const segments = lines.map((line, index) => {
    const range = rawRanges[index]!;
    const start = Math.max(previousEnd, range.start);
    const nextStart = rawRanges[index + 1]?.start;
    const end = Math.max(start, nextStart != null && Number.isFinite(nextStart) ? Math.min(range.end, nextStart) : range.end);
    previousEnd = end;
    return {
      id: `official-${index + 1}`,
      start,
      end,
      text: line,
      confidence: 0.8,
      source: "official-aligned" as const,
    };
  });

  return {
    source: "hybrid",
    rawText: officialText.trim(),
    draftText: draft.rawText,
    language: draft.language,
    words: officialWords,
    segments,
    correctedAt: Date.now(),
  };
}
