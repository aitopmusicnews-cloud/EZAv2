import { normalizeProductionLocks, normalizeShotLocks, shotLockReferenceIds } from "@mvs/shared";
import type { DirectorShot, ProductionBible, ReferenceAsset, TextToImageRequest } from "@mvs/shared";
import { directorScenePrompt } from "./director.js";
import { compileImagePrompt, compileNegativePrompt, compileVideoPrompt } from "./promptCompiler.js";

function shotContext(shot: DirectorShot, bible: ProductionBible, references: ReferenceAsset[]) {
  const normalized = normalizeProductionLocks(bible, references);
  const assigned = normalizeShotLocks(shot, normalized);
  const characters = normalized.characterLocks!.filter((lock) => assigned.characterIds.includes(lock.id));
  const assets = normalized.assetLocks!.filter((lock) => assigned.assetIds.includes(lock.id));
  const ids = shotLockReferenceIds(assigned, normalized);
  if (ids.length > 8) throw new Error("A shot supports at most 8 reference images. Remove some assigned asset locks.");
  const selected = ids.map((id) => {
    const ref = references.find((item) => item.id === id);
    if (!ref?.url) throw new Error("An assigned lock is missing its reference image. Replace it before generation.");
    const lock = [...characters, ...assets].find((item) => item.referenceAssetId === id)!;
    return { ...ref, role: "slot" in lock ? "character" as const : lock.type, locked: true, name: lock.name };
  });
  const rules = [
    "PER-SHOT LOCKS ARE AUTHORITATIVE and override all other text. References are separate identities/objects, never blend faces. Each assigned character is one unique person and must appear only once as a physical subject in the frame; never clone, duplicate, twin, or repeat the same identity.",
    characters.length ? `Only these ${characters.length} assigned characters may appear; no extra people: ${characters.map((lock) => `${lock.id} (${lock.name}): ${lock.notes ?? ""}`).join("; ")}.`
      : "No characters assigned. Show environment, objects or abstract coverage only; no people, faces, performers or crowds, even if other text mentions them.",
    ...selected.map((ref, index) => `Reference image ${index + 1}: ${ref.role} — ${ref.name}. Preserve this identity or asset exactly.`),
    ...assets.map((lock) => `Locked ${lock.type} ${lock.name}: ${lock.notes ?? "preserve its appearance; do not replace or redesign it"}.`),
    "Do not introduce any unassigned locked characters or assets.",
    "No duplicate people, cloned bodies, repeated faces, twin copies, or extra versions of an assigned character in images or video. A reflection may reflect the same person only when the shot explicitly requires a reflection; it must not become a second physical person.",
    shot.continuityNotes ?? "",
  ].filter(Boolean).join("\n");
  const has = (type: string) => assets.some((lock) => lock.type === type);
  const scopedBible = { ...normalized,
    characterProfile: characters.length ? characters.map((lock) => `${lock.name}: ${lock.notes ?? "Match reference"}`).join("; ") : undefined,
    vehicleProfile: has("vehicle") ? bible.vehicleProfile : undefined,
    wardrobeProfile: has("wardrobe") ? bible.wardrobeProfile : undefined,
    locationProfile: has("location") ? bible.locationProfile : undefined,
    defaultSpatialLock: has("vehicle") ? bible.defaultSpatialLock : undefined,
  };
  return { selected, rules, scopedBible };
}

export function compileDirectorImageRequest(
  shot: DirectorShot,
  bible: ProductionBible = {},
  references: ReferenceAsset[] = [],
  size = "1536x864",
): TextToImageRequest {
  const { selected, rules, scopedBible } = shotContext(shot, bible, references);
  const promptText = compileImagePrompt({
    scenePrompt: `${rules}\n${directorScenePrompt(shot)}`,
    productionBible: scopedBible,
    spatialLock: scopedBible.defaultSpatialLock,
    referenceAssets: selected,
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
  const { selected, rules, scopedBible } = shotContext(shot, bible, references);
  const videoRules = rules.replace(/^Reference image \d+: (.+)$/gm, "In the approved storyboard: $1");
  const scenePrompt = `${videoRules}\n${directorScenePrompt(shot)} Animate the approved storyboard image with natural cinematic movement. Preserve the approved subject identity, wardrobe, vehicle, environment, lighting direction, and composition. Do not redesign the scene.`;
  return {
    promptText: compileVideoPrompt({
      scenePrompt,
      productionBible: scopedBible,
      spatialLock: scopedBible.defaultSpatialLock,
      referenceAssets: selected,
    }),
    negativePrompt: compileNegativePrompt({
      productionBible: scopedBible,
      spatialLock: scopedBible.defaultSpatialLock,
    }),
    referenceAssetIds: selected.map((asset) => asset.id),
  };
}
