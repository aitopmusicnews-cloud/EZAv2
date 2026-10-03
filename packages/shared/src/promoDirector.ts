import { z } from "zod";

export const PromoBrief = z.object({
  product: z.string().trim().min(1).max(200),
  audience: z.string().trim().min(1).max(500),
  facts: z.string().trim().min(1).max(6000),
  callToAction: z.string().trim().min(1).max(500),
  style: z.string().trim().min(1).max(300),
  duration: z.union([z.literal(15), z.literal(30), z.literal(60)]),
});
export type PromoBrief = z.infer<typeof PromoBrief>;
// In-progress forms may contain empty fields; only submission requires them.
export const PromoBriefDraft = PromoBrief.extend({
  product: z.string().max(200), audience: z.string().max(500), facts: z.string().max(6000),
  callToAction: z.string().max(500), style: z.string().max(300),
});
export const PromoDirectorShot = z.object({
  title: z.string().trim().min(1).max(120),
  duration: z.number().finite().min(0.5).max(30),
  purpose: z.string().trim().min(1).max(600),
  visualPrompt: z.string().trim().min(1).max(2000),
  realFootage: z.boolean(),
  assetIndex: z.number().int().min(-1).max(9),
  onScreenText: z.string().max(80),
});
export const PromoDirectorPlan = z.object({
  concept: z.string().trim().min(1).max(2000),
  narration: z.string().trim().min(1).max(4000),
  voiceDirection: z.string().trim().min(1).max(700),
  continuity: z.string().trim().min(1).max(1000),
  reviewNotes: z.array(z.string().max(500)).max(10),
  shots: z.array(PromoDirectorShot).min(1).max(10),
});
export type PromoDirectorPlan = z.infer<typeof PromoDirectorPlan>;
export const PromoDirectorRequest = z.object({
  brief: PromoBrief,
  assets: z.array(z.object({ name: z.string().max(300), kind: z.enum(["image", "video"]) })).max(10),
  previousPlan: PromoDirectorPlan.optional(),
  revision: z.string().max(2000).optional(),
});
export type PromoDirectorRequest = z.infer<typeof PromoDirectorRequest>;
export const PromoSpeechRequest = z.object({
  script: z.string().trim().min(1).max(4000),
  voice: z.enum(["marin", "cedar", "coral", "onyx", "nova", "sage"]),
  direction: z.string().max(1000),
  speed: z.number().finite().min(0.75).max(1.25),
});
export type PromoSpeechRequest = z.infer<typeof PromoSpeechRequest>;

const AudioAsset = z.object({ name: z.string(), url: z.string(), duration: z.number().positive().optional(), spokenScript: z.string().optional(), voiceSettings: z.string().optional() });
export const PromoSavedDraft = z.object({
  scenes: z.array(z.object({
    id: z.string(), name: z.string(), url: z.string(), kind: z.enum(["image", "video"]),
    duration: z.number().finite().min(0.5).max(30), motion: z.enum(["static", "push-in", "zoom-out", "pan-left", "pan-right"]),
    fit: z.enum(["cover", "contain"]), focalX: z.number().min(0).max(100), focalY: z.number().min(0).max(100),
    uiSafe: z.boolean(), text: z.string(), textIn: z.number().finite(), textOut: z.number().finite(),
    textPosition: z.enum(["top", "center", "bottom"]), productionNotes: z.string(), realFootage: z.boolean().optional(),
  })).max(10),
  aspectRatio: z.enum(["9:16", "16:9", "4:5"]), music: AudioAsset.nullable(), voice: AudioAsset.nullable(),
  musicVolume: z.number().min(0).max(1.25), voiceVolume: z.number().min(0).max(1.5), duckMusic: z.boolean(),
  voiceScript: z.string(), voiceDirection: z.string(), voiceName: PromoSpeechRequest.shape.voice,
  voiceSpeed: z.number().min(0.75).max(1.25), targetDuration: z.number().positive().optional(),
  renderUrl: z.string().nullable(),
});
export type PromoSavedDraft = z.infer<typeof PromoSavedDraft>;

export function validatePromoPlan(plan: PromoDirectorPlan, request: PromoDirectorRequest): void {
  const duration = plan.shots.reduce((n, shot) => n + shot.duration, 0);
  if (Math.abs(duration - request.brief.duration) > 0.05) throw new Error("Shot durations must equal the requested promo length.");
  if (plan.shots.some((s) => s.assetIndex >= request.assets.length)) throw new Error("The plan references an unavailable asset.");
  if (plan.narration.split(/\s+/).length > request.brief.duration * 2.7) throw new Error("Narration is too long for a natural delivery. Shorten the script.");
}

export type PromoCheckScene = { url: string; duration: number; text: string; textIn: number; textOut: number; uiSafe: boolean; motion: string; fit: string };
export function checkPromoEdit(input: {
  scenes: PromoCheckScene[]; musicUrl?: string; voiceUrl?: string;
  musicVolume: number; voiceVolume: number; voiceDuration?: number;
  script?: string; spokenScript?: string; targetDuration?: number;
  voiceSettings?: string; currentVoiceSettings?: string;
}): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const duration = input.scenes.reduce((n, s) => n + s.duration, 0);
  if (!input.scenes.length) errors.push("Add scenes before exporting.");
  input.scenes.forEach((s, i) => {
    if (!s.url) errors.push(`Scene ${i + 1}: upload or generate the visual.`);
    if (!Number.isFinite(s.duration) || s.duration < 0.5 || s.duration > 30) errors.push(`Scene ${i + 1}: duration must be between 0.5 and 30 seconds.`);
    if (s.text.trim() && (s.textOut <= s.textIn || s.textIn < 0 || s.textOut > s.duration)) errors.push(`Scene ${i + 1}: fix the text timing.`);
    if (s.text.split("\n").some((line) => line.length > 26)) warnings.push(`Scene ${i + 1}: shorten or split the text into lines and check the rendered result.`);
    if (s.uiSafe && (s.fit !== "contain" || s.motion !== "static")) errors.push(`Scene ${i + 1}: use static motion and full-image fit for exact app screens.`);
  });
  if (input.voiceDuration && input.voiceDuration > duration + 0.1) errors.push(`Voiceover is ${input.voiceDuration.toFixed(1)}s; extend the edit or shorten/regenerate narration to avoid cutting it off.`);
  if (input.spokenScript !== undefined && input.spokenScript !== input.script?.trim()) errors.push("The narration script changed. Regenerate the voiceover or restore the spoken script.");
  if (input.voiceSettings !== undefined && input.voiceSettings !== input.currentVoiceSettings) errors.push("The narrator settings changed. Regenerate the voiceover to apply them.");
  if (input.script?.trim() && !input.voiceUrl) errors.push("Generate or upload the voiceover for this script.");
  if (!input.musicUrl && !input.voiceUrl) warnings.push("This export has no music or voiceover.");
  if (input.musicUrl && input.musicVolume === 0) warnings.push("Background music is muted.");
  if (input.voiceUrl && input.voiceVolume === 0) errors.push("Voiceover volume is zero.");
  if (input.targetDuration && Math.abs(duration - input.targetDuration) > 0.1) warnings.push(`The edit is ${duration.toFixed(1)}s; the brief requested ${input.targetDuration}s.`);
  const urls = input.scenes.map((s) => s.url).filter(Boolean);
  if (new Set(urls).size < urls.length) warnings.push("Some visuals repeat. Check that the repetition supports the story.");
  return { errors, warnings };
}
