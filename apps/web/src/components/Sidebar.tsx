import { useEffect, useMemo, useState } from "react";
import { useStore } from "../lib/store.js";
import type { Clip } from "@mvs/shared";
import { AGNES_VIDEO_MODEL, getErrorMessage } from "@mvs/shared";
import { enqueueGeneration, type GenerationSource } from "../lib/scheduler.js";
import { extractLastFrame, listSavedClips, type SavedClip } from "../lib/api.js";
import { AssetUploader } from "./AssetUploader.js";
import { toast } from "../lib/toast.js";

const SOURCES: Array<{ value: GenerationSource | "library"; label: string; desc: string }> = [
  { value: "textToVideo", label: "Text → Video", desc: "Describe the scene and let Agnes create the visual." },
  { value: "imageToVideo", label: "Image → Video", desc: "Animate a character or lookbook reference with Agnes." },
  { value: "keyframeToVideo", label: "Keyframe → Video", desc: "Transition between a start and end reference frame." },
  { value: "library", label: "Clip library", desc: "Reuse a saved clip without launching generation." },
];

export function Sidebar() {
  const selectedId = useStore((s) => s.selectedClipId);
  const clips = useStore((s) => s.clips);
  const analysis = useStore((s) => s.analysis);
  const lookbook = useStore((s) => s.lookbook);
  const characterImage = useStore((s) => s.characterImageUrl);
  const addLookbook = useStore((s) => s.addLookbook);
  const updateClip = useStore((s) => s.updateClip);
  const clip = useMemo(() => clips.find((c) => c.id === selectedId) ?? null, [clips, selectedId]);
  const [extracting, setExtracting] = useState(false);

  if (!clip || !analysis) return null;

  const source: GenerationSource | "library" =
    clip.source === "imageToVideo" || clip.source === "keyframeToVideo" || clip.source === "library"
      ? clip.source
      : "textToVideo";
  const section = analysis.sections.find((s) => s.start <= clip.start && s.end >= clip.end);
  const sectionLabel = section?.label ?? "section";
  const durationSec = clip.end - clip.start;
  const energy = avgRms(analysis.rmsCurve, clip.start, clip.end, analysis.duration);
  const prompt = clip.prompt ?? "";
  const availableImages = Array.from(new Set([characterImage, ...lookbook].filter((v): v is string => Boolean(v))));
  const selectedImage = clip.archetypeUrl ?? availableImages[0];
  const endImage = clip.keyframeEndUrl;
  const canGenerate = checkCanGenerate(source, { prompt, selectedImage, endImage });

  const setSource = (next: GenerationSource | "library") => {
    updateClip(clip.id, {
      source: next,
      model: next === "library" ? undefined : AGNES_VIDEO_MODEL,
      lastError: undefined,
    });
  };

  const onGenerate = () => {
    if (source === "library") return;
    if (!canGenerate.ok) {
      toast.warning(canGenerate.reason);
      return;
    }
    enqueueGeneration({
      clipId: clip.id,
      source,
      seedImageUrl: source === "textToVideo" ? "" : selectedImage ?? "",
      endImageUrl: source === "keyframeToVideo" ? endImage ?? "" : "",
      prompt,
      duration: durationSec,
      sectionLabel,
      energy,
      model: AGNES_VIDEO_MODEL,
    });
  };

  const onExtractFrame = async () => {
    if (!clip.videoUrl) return;
    setExtracting(true);
    try {
      const { url } = await extractLastFrame(clip.videoUrl);
      addLookbook(url);
      updateClip(clip.id, { archetypeUrl: url });
      toast.success("Last frame saved as a reusable reference");
    } catch (error) {
      toast.error(`Frame extraction failed: ${getErrorMessage(error)}`);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <>
      <div className="sidebar-header-row">
        <span className="pill">Agnes Video</span>
        <span className="meta">{durationSec.toFixed(1)}s · {clip.id}</span>
      </div>

      <div className="option-group">
        <div className="label">Generation mode</div>
        <div className="select-wrap">
          <select className="select" value={source} onChange={(e) => setSource(e.target.value as GenerationSource | "library")}>
            {SOURCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <span className="select-chevron">▾</span>
        </div>
        <div className="select-desc">{SOURCES.find((item) => item.value === source)?.desc}</div>
      </div>

      {source === "library" ? (
        <SavedClipPicker
          currentVideoUrl={clip.videoUrl}
          onPick={(saved) => updateClip(clip.id, {
            source: "library",
            videoUrl: saved.videoUrl,
            status: "ready",
            generationTaskId: undefined,
            model: saved.model ?? undefined,
            prompt: saved.prompt ?? undefined,
            lastError: undefined,
          })}
        />
      ) : (
        <>
          {(source === "imageToVideo" || source === "keyframeToVideo") && (
            <div className="option-group">
              <div className="label">First-frame reference</div>
              <ImageSeedGrid
                images={availableImages}
                selectedUrl={selectedImage}
                onPick={(url) => updateClip(clip.id, { archetypeUrl: url })}
                onUpload={(url) => { addLookbook(url); updateClip(clip.id, { archetypeUrl: url }); }}
                emptyText="Upload a character or lookbook image for Agnes."
              />
            </div>
          )}

          {source === "keyframeToVideo" && (
            <div className="option-group">
              <div className="label">End-frame reference</div>
              <ImageSeedGrid
                images={availableImages}
                selectedUrl={endImage}
                onPick={(url) => updateClip(clip.id, { keyframeEndUrl: url })}
                onUpload={(url) => { addLookbook(url); updateClip(clip.id, { keyframeEndUrl: url }); }}
                emptyText="Choose or upload the visual Agnes should reach at the end."
              />
            </div>
          )}

          <div className="option-group">
            <div className="label">{source === "keyframeToVideo" ? "Transition prompt" : source === "imageToVideo" ? "Motion prompt" : "Scene prompt"}</div>
            <textarea
              className="prompt"
              placeholder="Describe subject, action, camera movement, lighting, and style…"
              value={prompt}
              onChange={(e) => updateClip(clip.id, { prompt: e.target.value })}
            />
            <div className="select-desc">Generated clip audio is discarded; the original uploaded song remains the final soundtrack.</div>
          </div>

          <div className="option-group">
            <div className="label">Audio context</div>
            <div className="context-card">
              <div className="row"><span>Section</span><span>{sectionLabel}</span></div>
              <div className="row"><span>Energy</span><span>{energy.toFixed(2)}</span></div>
              <div className="row"><span>Timeline duration</span><span>{durationSec.toFixed(2)}s</span></div>
              <div className="row"><span>Model</span><span>Agnes Video V2.0</span></div>
            </div>
          </div>

          {clip.status === "ready" && clip.videoUrl && (
            <div className="option-group">
              <button type="button" className="btn ghost w-full" onClick={onExtractFrame} disabled={extracting}>
                {extracting ? "Extracting frame…" : "Save last frame as reference"}
              </button>
            </div>
          )}

          {clip.lastError && (
            <div className="error-card">
              <div className="error-title">Last attempt</div>
              <div className="error-message">{clip.lastError}</div>
            </div>
          )}

          <div className="sidebar-footer">
            <button
              className="generate-btn"
              onClick={onGenerate}
              disabled={clip.status === "queued" || clip.status === "generating" || !canGenerate.ok}
              title={canGenerate.ok ? undefined : canGenerate.reason}
            >
              {clip.status === "queued" ? "Queued…" : clip.status === "generating" ? "Generating with Agnes…" : clip.status === "failed" ? "Retry Agnes" : clip.status === "ready" ? "Regenerate with Agnes" : "Generate with Agnes"}
            </button>
            {(clip.videoUrl || clip.status !== "empty") && (
              <button type="button" className="btn ghost clear-clip-btn" onClick={() => updateClip(clip.id, {
                status: "empty",
                videoUrl: undefined,
                thumbnailUrl: undefined,
                generationTaskId: undefined,
                lastError: undefined,
              })}>Clear clip</button>
            )}
          </div>
        </>
      )}
    </>
  );
}

type CanGenerate = { ok: true; reason?: string } | { ok: false; reason: string };
function checkCanGenerate(source: GenerationSource | "library", context: { prompt: string; selectedImage?: string; endImage?: string }): CanGenerate {
  if (source === "library") return { ok: true };
  if (!context.prompt.trim()) return { ok: false, reason: "Describe the scene before generating" };
  if ((source === "imageToVideo" || source === "keyframeToVideo") && !context.selectedImage) return { ok: false, reason: "Select or upload a first-frame reference image" };
  if (source === "keyframeToVideo" && !context.endImage) return { ok: false, reason: "Select or upload an end-frame reference image" };
  return { ok: true };
}

function ImageSeedGrid({ images, selectedUrl, onPick, onUpload, emptyText }: { images: string[]; selectedUrl?: string; onPick: (url: string) => void; onUpload: (url: string) => void; emptyText: string }) {
  return (
    <div className="archetype-grid">
      {images.map((url) => (
        <div key={url} className="archetype-tile-wrap">
          <button type="button" className={`archetype-tile${selectedUrl === url ? " selected" : ""}`} style={{ backgroundImage: `url(${url})` }} onClick={() => onPick(url)} aria-label="Select Agnes reference" />
        </div>
      ))}
      <AssetUploader className="archetype-tile add" onUploaded={onUpload}><span className="tile-add-label">+</span></AssetUploader>
      {images.length === 0 && <div className="archetype-empty">{emptyText}</div>}
    </div>
  );
}

function SavedClipPicker({ currentVideoUrl, onPick }: { currentVideoUrl: string | undefined; onPick: (clip: SavedClip) => void }) {
  const [clips, setClips] = useState<SavedClip[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setLoading(true); setError(null);
    listSavedClips().then(setClips).catch((err) => setError(getErrorMessage(err))).finally(() => setLoading(false));
  };
  useEffect(refresh, []);
  return (
    <div className="option-group">
      <div className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span>Saved clips</span><button type="button" className="add" onClick={refresh} disabled={loading}>{loading ? "…" : "refresh"}</button></div>
      {error && <div className="cast-error">{error}</div>}
      {clips?.length === 0 && !error && <div className="archetype-empty">No saved clips yet.</div>}
      {!!clips?.length && <div className="saved-clip-list">{clips.map((c) => {
        const selected = c.videoUrl === currentVideoUrl;
        return <button key={c.id} type="button" className={`saved-clip-item${selected ? " selected" : ""}`} onClick={() => onPick(c)}>
          <video className="saved-clip-thumb" src={c.videoUrl} muted playsInline preload="metadata" />
          <div className="saved-clip-meta"><div className="saved-clip-name">{c.name}</div><div className="saved-clip-sub">{c.duration.toFixed(1)}s{c.sectionLabel ? ` · ${c.sectionLabel}` : ""}</div></div>
          {selected && <span className="saved-clip-tick">✓</span>}
        </button>;
      })}</div>}
    </div>
  );
}

function avgRms(curve: number[], start: number, end: number, duration: number): number {
  if (!curve.length) return 0;
  const i0 = Math.max(0, Math.floor((start / duration) * curve.length));
  const i1 = Math.min(curve.length, Math.ceil((end / duration) * curve.length));
  const slice = curve.slice(i0, Math.max(i0 + 1, i1));
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}
