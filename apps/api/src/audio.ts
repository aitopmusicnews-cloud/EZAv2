import { AudioAnalysis } from "@mvs/shared";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { readAnalysis, writeAnalysis } from "./storage.js";

const execFileAsync = promisify(execFile);
const AUDIO_ANALYSIS_CLI = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../audio_analysis/analyze_cli.py",
);

const ANALYSIS_ENV = {
  ...process.env,
  // Keep scientific runtimes inside Render's small CPU/memory envelope.
  OMP_NUM_THREADS: "1",
  OPENBLAS_NUM_THREADS: "1",
  MKL_NUM_THREADS: "1",
  NUMEXPR_NUM_THREADS: "1",
};

type AudioAnalysisResponse = {
  duration: number;
  bpm: number;
  key: string;
  beats: number[];
  downbeats: number[];
  onsets: number[];
  rms_curve: number[];
  sections: Array<{ start: number; end: number; label: string }>;
};

let analysisRuntimeAvailable: boolean | null = null;

async function checkAnalysisRuntime(): Promise<boolean> {
  if (analysisRuntimeAvailable !== null) return analysisRuntimeAvailable;
  try {
    const { stdout } = await execFileAsync(
      "python3",
      ["-c", "import numpy, scipy, soundfile; print('ok')"],
      { timeout: 5_000, env: ANALYSIS_ENV },
    );
    analysisRuntimeAvailable = stdout.trim() === "ok";
  } catch {
    analysisRuntimeAvailable = false;
  }
  return analysisRuntimeAvailable;
}

function normalizeAnalysis(raw: AudioAnalysisResponse): AudioAnalysis {
  return {
    duration: raw.duration,
    bpm: raw.bpm,
    key: raw.key,
    beats: raw.beats,
    downbeats: raw.downbeats,
    onsets: raw.onsets,
    rmsCurve: raw.rms_curve,
    sections: raw.sections,
  };
}

async function analyzeLocalFile(filePath: string): Promise<AudioAnalysis> {
  if (!(await checkAnalysisRuntime())) {
    throw new Error(
      "Audio analysis requires Python 3 with numpy, scipy, and soundfile installed. Install audio_analysis/requirements.txt.",
    );
  }
  if (!existsSync(AUDIO_ANALYSIS_CLI)) {
    throw new Error(`Audio analysis CLI is missing at ${AUDIO_ANALYSIS_CLI}.`);
  }

  const { stdout } = await execFileAsync("python3", [AUDIO_ANALYSIS_CLI, filePath], {
    maxBuffer: 50 * 1024 * 1024,
    timeout: 5 * 60_000,
    env: ANALYSIS_ENV,
  });
  return normalizeAnalysis(JSON.parse(stdout) as AudioAnalysisResponse);
}

/**
 * Analyze the exact bytes accepted by the upload route. This avoids relying on
 * provider URLs or background processes and works identically with local or S3
 * media storage.
 */
export async function analyzeAudioBytes(
  songId: string,
  bytes: Buffer,
  originalName: string,
): Promise<AudioAnalysis> {
  const cached = await readAnalysis(songId);
  if (cached) return cached;

  const tempDir = await mkdtemp(join(tmpdir(), "mvs-audio-analysis-"));
  const suffix = extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10);
  const filePath = join(tempDir, `song${suffix || ".media"}`);
  try {
    await writeFile(filePath, bytes);
    const analysis = await analyzeLocalFile(filePath);
    await writeAnalysis(songId, analysis);
    return analysis;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
