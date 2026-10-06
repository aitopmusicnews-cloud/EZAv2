import { useState } from "react";
import { normalizeProductionLocks, normalizeShotLocks, type AssetLock, type CharacterLockSlot, type DirectorShot, type ReferenceAsset } from "@mvs/shared";
import { useStore } from "../lib/store.js";
import { uploadImage } from "../lib/api.js";
import "../styles/productionLocks.css";

const ASSET_TYPES: AssetLock["type"][] = ["vehicle", "wardrobe", "prop", "location", "product", "style"];

export function ProductionLocks() {
  const productionBible = useStore((s) => s.productionBible);
  const references = useStore((s) => s.referenceAssets);
  const lookbook = useStore((s) => s.lookbook);
  const characterImage = useStore((s) => s.characterImageUrl);
  const updateBible = useStore((s) => s.updateDirectorBible);
  const upsert = useStore((s) => s.upsertReferenceAsset);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [assetType, setAssetType] = useState<AssetLock["type"]>("prop");
  const bible = normalizeProductionLocks(productionBible ?? {}, references);
  const images = [...new Set([characterImage, ...lookbook, ...references.map((ref) => ref.url)].filter((url): url is string => !!url))];
  const saveCharacter = (slot: 1 | 2 | 3, patch?: Partial<CharacterLockSlot>) => {
    const current = normalizeProductionLocks(useStore.getState().productionBible ?? {}, useStore.getState().referenceAssets);
    const previous = current.characterLocks!.find((lock) => lock.slot === slot);
    const others = current.characterLocks!.filter((lock) => lock.slot !== slot);
    updateBible({ characterLocks: patch ? [...others, { id: previous?.id ?? `character-${slot}`, slot, name: `Character ${slot}`, locked: true, ...previous, ...patch } as CharacterLockSlot].sort((a, b) => a.slot - b.slot) : others });
  };
  const saveAsset = (id: string, patch?: Partial<AssetLock>) => {
    const current = normalizeProductionLocks(useStore.getState().productionBible ?? {}, useStore.getState().referenceAssets);
    updateBible({ assetLocks: patch ? current.assetLocks!.map((lock) => lock.id === id ? { ...lock, ...patch } : lock) : current.assetLocks!.filter((lock) => lock.id !== id) });
  };
  const reference = (url: string, role: ReferenceAsset["role"]) => {
    const state = useStore.getState();
    if (!state.productionBible?.characterLocks || !state.productionBible?.assetLocks) {
      updateBible(normalizeProductionLocks(state.productionBible ?? {}, state.referenceAssets));
    }
    const existing = useStore.getState().referenceAssets.find((ref) => ref.url === url && ref.role === role);
    const ref = existing ?? { id: `ref-${crypto.randomUUID()}`, url, role, locked: true, name: role };
    upsert({ ...ref, locked: true });
    return ref.id;
  };
  const addAsset = (url: string) => {
    if (!url) return;
    const referenceAssetId = reference(url, assetType);
    const current = normalizeProductionLocks(useStore.getState().productionBible ?? {}, useStore.getState().referenceAssets);
    updateBible({ assetLocks: [...current.assetLocks!, { id: `asset-${crypto.randomUUID()}`, type: assetType, name: `Locked ${assetType}`, referenceAssetId, locked: true }] });
  };
  const upload = async (file: File | undefined, apply: (url: string) => void) => {
    if (!file) return;
    setUploading(true); setError("");
    try { const result = await uploadImage(file); apply(result.url); }
    catch (err) { setError(err instanceof Error ? err.message : "Image upload failed"); }
    finally { setUploading(false); }
  };
  const picker = (value: string, onChange: (url: string) => void, label: string) => <>
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={uploading}>
      <option value="">Choose reference image…</option>
      {images.map((url, i) => <option key={url} value={url}>{references.find((ref) => ref.url === url)?.name ?? `Image ${i + 1}`}</option>)}
    </select>
    <label className="lock-upload">Upload reference<input aria-label={`Upload ${label}`} type="file" accept="image/*" disabled={uploading} onChange={(event) => { void upload(event.target.files?.[0], onChange); event.target.value = ""; }} /></label>
  </>;
  return <section className="production-locks" aria-label="Production locks">
    <h3>Character Locks</h3>
    <p>Lock up to three people before building a treatment, or change them here and use Talk to Director to revise the casting. Review each shot’s assignments before generating. Reference images take priority over written descriptions. For multi-artist songs, name each Character Lock exactly like the Artist / Vocalist label used on the Lyrics screen so BeatSync can map separate verses to the correct performer.</p>
    <div className="lock-grid">
      {([1, 2, 3] as const).map((slot) => {
        const lock = bible.characterLocks!.find((item) => item.slot === slot);
        const url = references.find((ref) => ref.id === lock?.referenceAssetId)?.url ?? "";
        return <div className="lock-card" key={slot}>
          <strong>Character {slot} · {slot === 1 ? "Lead" : "Support"}</strong>
          {url && <img src={url} alt={lock?.name ?? `Character ${slot}`} />}
          {picker(url, (url) => url ? saveCharacter(slot, { referenceAssetId: reference(url, "character") }) : saveCharacter(slot), `Character ${slot} reference`)}
          {lock && <>
            <input aria-label={`Character ${slot} name`} value={lock.name} onChange={(event) => saveCharacter(slot, { name: event.target.value })} />
            <textarea aria-label={`Character ${slot} notes`} placeholder="Role and continuity notes" value={lock.notes ?? ""} onChange={(event) => saveCharacter(slot, { notes: event.target.value })} />
            <label><input type="checkbox" checked={lock.locked} onChange={(event) => saveCharacter(slot, { locked: event.target.checked })} /> Lock active</label>
            <button type="button" className="btn ghost" onClick={() => saveCharacter(slot)}>Clear</button>
          </>}
        </div>;
      })}
    </div>
    <h3>Asset Locks</h3>
    <div className="lock-grid">
      {bible.assetLocks!.map((lock) => {
        const url = references.find((ref) => ref.id === lock.referenceAssetId)?.url ?? "";
        return <div className="lock-card" key={lock.id}>
          {url && <img src={url} alt={lock.name} />}
          <input aria-label="Asset name" value={lock.name} onChange={(event) => saveAsset(lock.id, { name: event.target.value })} />
          <select aria-label="Asset type" value={lock.type} onChange={(event) => saveAsset(lock.id, { type: event.target.value as AssetLock["type"] })}>{ASSET_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
          {picker(url, (url) => url ? saveAsset(lock.id, { referenceAssetId: reference(url, lock.type) }) : saveAsset(lock.id), `${lock.name} reference`)}
          <textarea aria-label={`${lock.name} notes`} placeholder="Details to preserve" value={lock.notes ?? ""} onChange={(event) => saveAsset(lock.id, { notes: event.target.value })} />
          <label><input type="checkbox" checked={lock.locked} onChange={(event) => saveAsset(lock.id, { locked: event.target.checked })} /> Lock active</label>
          <button type="button" className="btn ghost" onClick={() => saveAsset(lock.id)}>Remove asset</button>
        </div>;
      })}
      <div className="lock-card">
        <strong>Add asset lock</strong>
        <select aria-label="New asset type" value={assetType} onChange={(event) => setAssetType(event.target.value as AssetLock["type"])}>{ASSET_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
        {picker("", addAsset, "New asset")}
      </div>
    </div>
    {uploading && <p role="status">Uploading reference…</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function ShotLockAssignments({ shot }: { shot: DirectorShot }) {
  const bible = useStore((s) => s.productionBible);
  const references = useStore((s) => s.referenceAssets);
  const updateShot = useStore((s) => s.updateDirectorShot);
  const normalized = normalizeProductionLocks(bible ?? {}, references);
  const assigned = normalizeShotLocks(shot, normalized);
  const toggle = (key: "characterIds" | "assetIds", id: string, checked: boolean) => updateShot(shot.id, { [key]: checked ? [...assigned[key], id] : assigned[key].filter((value) => value !== id) });
  return <div className="shot-locks">
    <fieldset><legend>Characters in shot</legend>
      {normalized.characterLocks!.filter((lock) => lock.locked).map((lock) => <label key={lock.id}><input type="checkbox" checked={assigned.characterIds.includes(lock.id)} onChange={(event) => toggle("characterIds", lock.id, event.target.checked)} /> C{lock.slot}: {lock.name}</label>)}
      {!assigned.characterIds.length && <small>No characters — environment / object / abstract shot.</small>}
    </fieldset>
    <fieldset><legend>Assets in shot</legend>
      {normalized.assetLocks!.filter((lock) => lock.locked).map((lock) => <label key={lock.id}><input type="checkbox" checked={assigned.assetIds.includes(lock.id)} onChange={(event) => toggle("assetIds", lock.id, event.target.checked)} /> {lock.name} ({lock.type})</label>)}
      {!assigned.assetIds.length && <small>No locked assets assigned.</small>}
    </fieldset>
    <label><input type="checkbox" checked={shot.hero} onChange={(event) => updateShot(shot.id, { hero: event.target.checked })} /> Hero shot</label>
    <label>Continuity notes<textarea value={shot.continuityNotes ?? ""} onChange={(event) => updateShot(shot.id, { continuityNotes: event.target.value })} placeholder="Details to preserve in this shot" /></label>
    <small>{assigned.characterIds.length + assigned.assetIds.length}/8 reference slots used</small>
  </div>;
}
