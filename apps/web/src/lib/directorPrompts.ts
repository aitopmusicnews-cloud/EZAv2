import type { DirectorShot, ProductionBible, ReferenceAsset, TextToImageRequest } from "@mvs/shared";
import { directorScenePrompt } from "./director.js";
import { compileImagePrompt, compileNegativePrompt, compileVideoPrompt } from "./promptCompiler.js";

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
    scenePrompt: directorScenePrompt(shot),
    productionBible: bible,
    spatialLock: bible.defaultSpatialLock,
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
  const selected = directorReferences(bible, references);
  const scenePrompt = `${directorScenePrompt(shot)} Animate the approved storyboard image with natural cinematic movement. Preserve the approved subject identity, wardrobe, vehicle, environment, lighting direction, and composition. Do not redesign the scene.`;
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
    }),
    referenceAssetIds: selected.map((asset) => asset.id),
  };
}
