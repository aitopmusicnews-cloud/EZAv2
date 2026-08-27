import type { AudioAnalysis, DirectorPlan, DirectorShot, ProductionBible } from "@mvs/shared";

const CAMERA_CYCLE = [
  "slow dolly forward",
  "smooth lateral tracking",
  "low-angle push-in",
  "controlled handheld drift",
  "gentle orbit around the subject",
  "locked-off cinematic composition",
] as const;

const FRAMING_CYCLE = ["wide", "medium", "medium close-up", "close-up", "detail insert"] as const;

function clamp(value: number, lo = 0, hi = 1): number {
  return Math.min(hi, Math.max(lo, value));
}

function id(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}-${suffix}`;
}

function nearestCut(target: number, candidates: number[], lo: number, hi: number): number {
  const usable = candidates.filter((value) => value > lo && value < hi);
  if (!usable.length) return target;
  return usable.reduce((best, value) => Math.abs(value - target) < Math.abs(best - target) ? value : best, usable[0]!);
}

function sectionBoundaries(start: number, end: number, analysis: AudioAnalysis): number[] {
  const length = end - start;
  if (length <= 0) return [start, end];
  let count = Math.max(1, Math.ceil(length / 5));
  while (count > 1 && length / count < 2) count -= 1;
  const points = [start];
  const musicalCuts = analysis.downbeats.length ? analysis.downbeats : analysis.beats;
  for (let i = 1; i < count; i += 1) {
    const nominal = start + (length * i) / count;
    const previous = points[points.length - 1]!;
    const min = previous + 1.5;
    const max = Math.min(end - Math.max(1.5, (count - i - 1) * 1.5), previous + 6);
    const snapped = nearestCut(nominal, musicalCuts, min, max);
    points.push(clamp(snapped, min, max));
  }
  points.push(end);
  return points;
}

function averageEnergy(analysis: AudioAnalysis, start: number, end: number): number {
  if (!analysis.rmsCurve.length || analysis.duration <= 0) return 0.5;
  const maxRms = Math.max(...analysis.rmsCurve, 1e-6);
  const lo = Math.max(0, Math.floor((start / analysis.duration) * analysis.rmsCurve.length));
  const hi = Math.min(analysis.rmsCurve.length, Math.max(lo + 1, Math.ceil((end / analysis.duration) * analysis.rmsCurve.length)));
  const values = analysis.rmsCurve.slice(lo, hi);
  const avg = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return clamp(avg / maxRms);
}

function roleFor(
  sectionLabel: string,
  indexInSection: number,
  isFirst: boolean,
  context: { sectionIndex: number; sectionCount: number; highEnergy: boolean; nextHighEnergy: boolean },
): string {
  const label = sectionLabel.toLowerCase();
  if (isFirst) return "Hook / Establish";
  if (label.includes("chorus") || label.includes("hook") || label.includes("drop")) {
    return indexInSection % 2 === 0 ? "Hero Performance" : "Payoff Detail";
  }
  if (label.includes("pre") || label.includes("build")) return "Build";
  if (label.includes("bridge") || label.includes("break") || label.includes("interlude")) return "Breath / Contrast";
  if (label.includes("outro") || label.includes("ending")) return "Finale";
  if (label.includes("intro")) return "Establish";

  // EZAv2's local analyzer intentionally labels structural regions as
  // "section 1", "section 2", ... rather than guessing verse/chorus names.
  // BeatSync therefore derives editorial roles from position + relative energy.
  const generic = /^section\s+\d+$/i.test(sectionLabel.trim());
  if (generic) {
    if (context.sectionIndex === context.sectionCount - 1) return "Finale";
    if (context.highEnergy) return indexInSection % 2 === 0 ? "Hero Performance" : "Payoff Detail";
    if (context.nextHighEnergy) return "Build";
    return indexInSection % 2 === 0 ? "Performance" : "Story / B-roll";
  }
  return indexInSection % 2 === 0 ? "Performance" : "Story / B-roll";
}

function moodFor(energy: number): string {
  if (energy >= 0.75) return "bold, kinetic, high-impact";
  if (energy >= 0.5) return "confident, cinematic, controlled energy";
  if (energy >= 0.3) return "moody, elegant, atmospheric";
  return "intimate, restrained, spacious";
}

function framingFor(role: string, shotIndex: number, energy: number): string {
  if (role.includes("Hero")) return energy > 0.7 ? "medium close-up" : "close-up";
  if (role.includes("Establish")) return "wide";
  if (role.includes("Detail")) return "detail insert";
  return FRAMING_CYCLE[shotIndex % FRAMING_CYCLE.length]!;
}

function ideaFor(role: string, vision: string, sectionLabel: string): string {
  const world = vision.trim() || "a cinematic artist-led visual world inspired by the music";
  if (role === "Hook / Establish") return `Open with a striking visual reveal that immediately establishes ${world}.`;
  if (role === "Establish") return `Establish ${world} with a strong sense of place and visual identity.`;
  if (role === "Hero Performance") return `Create a hero performance moment for the ${sectionLabel}, making the artist the undeniable focal point within ${world}.`;
  if (role === "Payoff Detail") return `Use a memorable high-value detail or motion insert that amplifies the ${sectionLabel} payoff within ${world}.`;
  if (role === "Build") return `Increase anticipation and forward motion while staying visually consistent with ${world}.`;
  if (role === "Breath / Contrast") return `Give the edit a cinematic breath with a contrasting but connected image from ${world}.`;
  if (role === "Finale") return `Resolve the music video with a memorable closing image that feels earned within ${world}.`;
  if (role === "Performance") return `Show a confident artist performance moment that advances the visual language of ${world}.`;
  return `Advance the visual story with purposeful cinematic B-roll connected to ${world}.`;
}

function defaultStyleForAnalysis(analysis: AudioAnalysis): string {
  if (analysis.bpm >= 130) return "high-energy cinematic music video with polished editorial movement";
  if (analysis.bpm <= 90) return "moody cinematic music video with deliberate framing and atmospheric light";
  return "cinematic contemporary music video with confident pacing and premium visual polish";
}

function treatmentStyle(analysis: AudioAnalysis, bible: ProductionBible): string {
  if (bible.stylePrompt?.trim()) return bible.stylePrompt.trim();
  return defaultStyleForAnalysis(analysis);
}

export function suggestProductionBible(
  analysis: AudioAnalysis,
  vision: string,
  current: ProductionBible = {},
): ProductionBible {
  const creativeVision = vision.trim();
  const style = current.stylePrompt?.trim() || [
    defaultStyleForAnalysis(analysis),
    creativeVision ? `Creative direction: ${creativeVision}.` : "",
  ].filter(Boolean).join(". ");
  const location = current.locationProfile?.trim() || (creativeVision
    ? `Use the locations and environment implied by this project vision: ${creativeVision}. Keep geography and time-of-day logic consistent within connected scenes.`
    : "Choose locations that support the song's mood and energy. Keep geography and time-of-day logic consistent within connected scenes.");
  const palette = current.colorPalette?.trim() || (analysis.bpm >= 130
    ? "Bold cinematic contrast with controlled saturated highlights and consistent skin tones."
    : analysis.bpm <= 90
      ? "Deep cinematic shadows, restrained highlights, and a cohesive atmospheric palette."
      : "Premium cinematic contrast, natural skin tones, and a cohesive accent palette across the project.");

  return {
    ...current,
    wardrobeProfile: current.wardrobeProfile?.trim()
      || "Preserve approved wardrobe within connected scenes. Do not invent wardrobe changes unless the shot plan explicitly calls for one.",
    locationProfile: location,
    stylePrompt: style,
    colorPalette: palette,
    continuityPrompt: current.continuityPrompt?.trim()
      || "Preserve approved subject identity, wardrobe, key props, environment logic, lighting direction, and recurring visual details across related shots. Change them only when the plan explicitly introduces a new scene.",
    negativePrompt: current.negativePrompt?.trim()
      || "unintended identity changes, wardrobe drift, duplicate subjects, inconsistent recurring props, accidental text, logos, watermarks",
    // No defaultSpatialLock is invented here. Spatial rules stay Auto / None
    // unless the user or a specific scene deliberately opts into one.
  };
}

export function directorScenePrompt(shot: DirectorShot): string {
  const energy = shot.energy >= 0.75 ? "high" : shot.energy >= 0.45 ? "medium" : "low";
  return [
    shot.idea,
    `Story role: ${shot.role}.`,
    `Camera: ${shot.camera}.`,
    `Framing: ${shot.framing}.`,
    `Mood: ${shot.mood}.`,
    `Location / world: ${shot.location}.`,
    `Musical energy: ${energy}.`,
    shot.hero ? "Treat this as a hero image: strong subject clarity, premium composition, and memorable visual impact." : "Keep the composition clear and editorially useful for a music-video cut.",
  ].join(" ");
}

export function createDirectorPlan(
  analysis: AudioAnalysis,
  vision: string,
  bible: ProductionBible = {},
): DirectorPlan {
  const shots: DirectorShot[] = [];
  const sections = analysis.sections.length
    ? analysis.sections
    : [{ start: 0, end: analysis.duration, label: "section 1" }];
  const sectionEnergies = sections.map((section) => averageEnergy(analysis, section.start, section.end));
  const eligibleHeroSections = sections.length >= 3
    ? sectionEnergies.map((energy, index) => ({ energy, index })).filter(({ index }) => index > 0 && index < sections.length - 1)
    : sectionEnergies.map((energy, index) => ({ energy, index }));
  const heroSectionCount = Math.max(1, Math.min(2, Math.ceil(eligibleHeroSections.length * 0.34)));
  const heroSectionIndexes = new Set(
    eligibleHeroSections.sort((a, b) => b.energy - a.energy).slice(0, heroSectionCount).map(({ index }) => index),
  );
  let globalIndex = 0;
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex]!;
    const bounds = sectionBoundaries(section.start, section.end, analysis);
    for (let i = 0; i < bounds.length - 1; i += 1) {
      const start = bounds[i]!;
      const end = bounds[i + 1]!;
      if (end <= start) continue;
      const energy = averageEnergy(analysis, start, end);
      const role = roleFor(section.label, i, globalIndex === 0, {
        sectionIndex,
        sectionCount: sections.length,
        highEnergy: heroSectionIndexes.has(sectionIndex),
        nextHighEnergy: heroSectionIndexes.has(sectionIndex + 1),
      });
      const hero = role === "Hero Performance" || (globalIndex === 0 && energy >= 0.55);
      const shotId = id("director-shot");
      shots.push({
        id: shotId,
        clipId: `clip-${shotId.slice(-8)}`,
        start,
        end,
        sectionLabel: section.label || "section",
        role,
        idea: ideaFor(role, vision, section.label || "section"),
        camera: role.includes("Hero") ? "slow cinematic push-in" : CAMERA_CYCLE[globalIndex % CAMERA_CYCLE.length]!,
        framing: framingFor(role, globalIndex, energy),
        mood: moodFor(energy),
        location: vision.trim() || "primary music-video visual world",
        energy,
        hero,
        imageStatus: "idle",
        imageApproved: false,
        videoApproved: false,
      });
      globalIndex += 1;
    }
  }
  if (!shots.length && analysis.duration > 0) {
    const shotId = id("director-shot");
    shots.push({
      id: shotId,
      clipId: `clip-${shotId.slice(-8)}`,
      start: 0,
      end: analysis.duration,
      sectionLabel: "song",
      role: "Hook / Establish",
      idea: ideaFor("Hook / Establish", vision, "song"),
      camera: "slow dolly forward",
      framing: "wide",
      mood: "cinematic, confident, controlled energy",
      location: vision.trim() || "primary music-video visual world",
      energy: 0.5,
      hero: true,
      imageStatus: "idle",
      imageApproved: false,
      videoApproved: false,
    });
  }
  const style = treatmentStyle(analysis, bible);
  const concept = vision.trim() || `A music-led cinematic visual concept shaped around ${analysis.bpm.toFixed(0)} BPM, ${analysis.key}, and the song's changing energy.`;
  return {
    id: id("director-plan"),
    version: 1,
    planningBasis: "legacy-audio-heuristic",
    vision: vision.trim(),
    treatment: {
      title: "BeatSync Director Treatment",
      concept,
      style,
      pacing: analysis.bpm >= 125 ? "energetic with deliberate hero holds" : analysis.bpm <= 90 ? "measured and atmospheric" : "dynamic with cinematic breathing room",
    },
    shots,
  };
}
