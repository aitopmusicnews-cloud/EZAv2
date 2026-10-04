import type { ProductionBible, ReferenceAsset, DirectorShot } from "./index.js";

/** Missing legacy selections inherit old locked references; explicit empty arrays stay empty. */
export function normalizeProductionLocks(bible: ProductionBible = {}, references: ReferenceAsset[] = []): ProductionBible {
  const characterLocks = bible.characterLocks ?? Array.from(new Set(bible.characterReferenceAssetIds
    ?? references.filter((ref) => ref.role === "character" && ref.locked).map((ref) => ref.id)))
    .slice(0, 3).map((id, index) => ({
      id: `character-${index + 1}`, slot: (index + 1) as 1 | 2 | 3,
      name: references.find((ref) => ref.id === id)?.name ?? `Character ${index + 1}`,
      referenceAssetId: id, locked: true,
    }));
  const assetLocks = bible.assetLocks ?? Array.from(new Set([
    ...(bible.vehicleReferenceAssetIds ?? []),
    ...references.filter((ref) => ref.locked && ref.role !== "character" &&
      (ref.role !== "vehicle" || bible.vehicleReferenceAssetIds === undefined)).map((ref) => ref.id),
  ])).map((id) => {
    const ref = references.find((item) => item.id === id);
    return { id: `asset-${id}`, type: ref && ref.role !== "character" ? ref.role : "vehicle" as const,
      name: ref?.name ?? "Vehicle", referenceAssetId: id, locked: true };
  });
  return { ...bible, characterLocks, assetLocks,
    characterReferenceAssetIds: characterLocks.filter((lock) => lock.locked).map((lock) => lock.referenceAssetId),
    vehicleReferenceAssetIds: assetLocks.filter((lock) => lock.locked && lock.type === "vehicle").map((lock) => lock.referenceAssetId),
  };
}

export function normalizeShotLocks<T extends Pick<DirectorShot, "characterIds" | "assetIds">>(shot: T, bible: ProductionBible): T & { characterIds: string[]; assetIds: string[] } {
  const normalized = normalizeProductionLocks(bible);
  const characters = normalized.characterLocks!.filter((lock) => lock.locked).map((lock) => lock.id);
  const assets = normalized.assetLocks!.filter((lock) => lock.locked).map((lock) => lock.id);
  return { ...shot,
    characterIds: [...new Set(shot.characterIds ?? characters)].filter((id) => characters.includes(id)),
    assetIds: [...new Set(shot.assetIds ?? assets)].filter((id) => assets.includes(id)),
  };
}

export function shotLockReferenceIds(shot: Pick<DirectorShot, "characterIds" | "assetIds">, bible: ProductionBible): string[] {
  const normalized = normalizeProductionLocks(bible);
  const assignments = normalizeShotLocks(shot, normalized);
  return [...new Set([
    ...normalized.characterLocks!.filter((lock) => assignments.characterIds.includes(lock.id)),
    ...normalized.assetLocks!.filter((lock) => assignments.assetIds.includes(lock.id)),
  ].map((lock) => lock.referenceAssetId))];
}
