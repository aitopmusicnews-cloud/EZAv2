import type { DirectorShot, ProductionBible, ReferenceAsset, TextToImageRequest } from "@mvs/shared";
import { directorScenePrompt } from "./director.js";
import { compileImagePrompt, compileNegativePrompt, compileVideoPrompt } from "./promptCompiler.js";

const REALISM_NEGATIVES = "unrequested duplicate of the same character, cloned faces, extra bodies, fused limbs, floating occupants, body intersecting car roof or doors, unoccupied moving driver seat, robotic joint motion, foot sliding, abrupt pose jumps";

function physicalDirection(shot: DirectorShot, bible: ProductionBible): string {
  const scene = `${shot.idea} ${shot.location}`;
  const vehicleScene = /\b(car|vehicle|driver|driving|passenger|steering|cabin|coupe|sedan|truck)\b/i.test(scene);
  return [
    "Show exactly the distinct people described in this shot, one physical instance of each character. Multiple reference views of one person describe the same identity, not additional cast members. Reflections must correspond to the same physical person.",
    "Preserve the approved cast and appearance; do not substitute a different face, age, skin tone, or wardrobe. Do not infer casting from the model provider or the music genre.",
    vehicleScene ? "For a human-driven moving vehicle, keep the driver seated inside the cabin behind the steering wheel throughout the shot. Keep hips on the seat, feet in the footwell and hands plausibly controlling the wheel. Respect the stated driver side. Keep occupants inside the vehicle geometry; no standing through the roof, floating beside the car, empty driver seat, or seat switching. Do not add occupants to a parked or explicitly unoccupied scene." : "",
    bible.characterProfile ? "Follow the supplied character profile and approved references." : "",
  ].filter(Boolean).join(" ");
}

function directorReferences(bible: ProductionBible, references: ReferenceAsset[]): ReferenceAsset[] {
  const explicit = new Set([
    ...(bible.characterReferenceAssetIds ?? []),
    ...(bible.vehicleReferenceAssetIds ?? []),
  ]);
  return references
    .filter((asset) => explicit.has(asset.id) || asset.locked === true)
    .filter((asset, index, all) => all.findIndex((item) => item.id === asset.id) === index)
    .slice(0, 8);
}

export function compileDirectorImageRequest(
  shot: DirectorShot,
  bible: ProductionBible = {},
  references: ReferenceAsset[] = [],
  size = "1536x864",
): TextToImageRequest {
  const selected = directorReferences(bible, references);
  const promptText = compileImagePrompt({
    scenePrompt: `${directorScenePrompt(shot)} ${physicalDirection(shot, bible)}`,
    productionBible: bible,
    spatialLock: bible.defaultSpatialLock,
    referenceAssets: selected,
    negativePrompt: REALISM_NEGATIVES,
  });
  return {
    promptText,
    size,
    mode: selected.length >= 2 ? "compose" : selected.length === 1 ? "img2img" : "text2img",
    ...(selected.length ? { referenceImages: selected } : {}),
  };
}

export function compileDirectorVideoRequest(
  shot: DirectorShot,
  bible: ProductionBible = {},
  references: ReferenceAsset[] = [],
): { promptText: string; negativePrompt: string; referenceAssetIds: string[] } {
  const selected = directorReferences(bible, references);
  const scenePrompt = `${directorScenePrompt(shot)} ${physicalDirection(shot, bible)} Animate this as one continuous ${(shot.end - shot.start).toFixed(2)}-second take with one clear main action. Use natural real-time movement with believable weight, balance, contact and smooth acceleration. Keep subtle breathing, blinks and small posture changes appropriate to the shot; avoid synchronized mechanical gestures and exaggerated movement. Follow only the stated camera movement, without adding cuts or competing camera moves. Musical energy guides mood, not forced body motion. Preserve the approved storyboard identity, wardrobe, vehicle, environment, lighting direction, and composition. Do not redesign the scene.`;
  return {
    promptText: compileVideoPrompt({
      scenePrompt,
      productionBible: bible,
      spatialLock: bible.defaultSpatialLock,
      referenceAssets: selected,
    }),
    negativePrompt: compileNegativePrompt({
      productionBible: bible,
      spatialLock: bible.defaultSpatialLock,
      negativePrompt: REALISM_NEGATIVES,
    }),
    referenceAssetIds: selected.map((asset) => asset.id),
  };
}
