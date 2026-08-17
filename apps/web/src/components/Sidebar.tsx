import { useEffect, useMemo, useState } from "react";
import { useStore } from "../lib/store.js";
import type { Clip } from "@mvs/shared";
import { AGNES_VIDEO_MODEL, getErrorMessage } from "@mvs/shared";
import { enqueueGeneration, type GenerationSource } from "../lib/scheduler.js";
import {
  extractLastFrame,
  generateTextToImage,
  listSavedClips,
  type SavedClip,
  type SavedImage,
} from "../lib/api.js";
import { applyLipSyncToClip } from "../lib/lipsync.js";
import { AssetUploader } from "./AssetUploader.js";
import { toast } from "../lib/toast.js";
import "../styles/generation-tools.css";

type SidebarMode = GenerationSource | "textToImage" | "library";

const SOURCES: Array<{ value: SidebarMode; label: string; desc: string }> = [
  { value: "textToVideo", label: "Text → Video", desc: "Describe the scene and let Agnes create the visual." },
  { value: "textToImage", label: "Text → Image", desc: "Create a reusable still image with Agnes before animating it." },
  { value: "imageToVideo", label: "Image → Video", desc: "Animate a character or lookbook reference with Agnes." },
  { value: "keyframeToVideo", label: "Keyframe → Video", desc: "Transition between a start and end reference frame." },
  { value: "library", label: "Clip library", desc: "Reuse a saved clip without launching generation." },
];

export function Sidebar() {
  const selectedId = useStore((s) => s.selectedClipId);
  const clips = useStore((s) => s.clips);
  const analysis = useStore((s) => s.analysis);
  const audioUrl = useStore((s) => s.audioUrl);
  const lookbook = useStore((s) => s.lookbook);
  const characterImage = useStore((s) => s.characterImageUrl);
  const addLookbook = useStore((s) => s.addLookbook);
  const updateClip = useStore((s) => s.updateClip);
  const clip = useMemo(() => clips.find((c) => c.id === selectedId) ?? null, [clips, selectedId]);
  const [extracting, setExtracting] = useState(false);
  const [mode, setMode] = useState<SidebarMode>("textToVideo");
  const [generatedImage, setGeneratedImage] = useState<SavedImage | null>(null);
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageSize, setImageSize] = useState("1536x864");

  useEffect(() => {
    if (!clip) return;
    const next: GenerationSource | "library" =
      clip.source === "imageToVideo" || clip.source === "keyframeToVideo" || clip.source === "library"
        ? clip.source
        : "textToVideo";
    setMode(next);
    setGeneratedImage(null);
  }, [clip?.id]);

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
  const isLipSyncing = clip.lipSyncStatus === "queued" || clip.lipSyncStatus === "generating";

  const setSource = (next: SidebarMode) => {
    setMode(next);
    if (next === "textToImage") return;
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

  const onGenerateImage = async () => {
    const promptText = (clip.imagePrompt ?? "").trim();
    if (!promptText) {
      toast.warning("Describe the image before generating");
      return;
    }
    setImageGenerating(true);
    try {
      const saved = await generateTextToImage({ promptText, size: imageSize });
      setGeneratedImage(saved);
      toast.success("Image generated and saved to Library → Images");
    } catch (error) {
      toast.error(`Image generation failed: ${getErrorMessage(error)}`);
    } finally {
      setImageGenerating(false);
    }
  };

  const onUseGeneratedImage = () => {
    if (!generatedImage) return;
    addLookbook(generatedImage.url);
    updateClip(clip.id, {
      source: "imageToVideo",
      archetypeUrl: generatedImage.url,
      model: AGNES_VIDEO_MODEL,
      lastError: undefined,
    });
    setMode("imageToVideo");
    toast.success("Image set as the selected clip's first-frame reference");
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

  const onLipSync = () => {
    void applyLipSyncToClip(clip.id)
      .then(() => toast.success("Lip-sync complete"))
      .catch((error) => toast.error(`Lip-sync failed: ${getErrorMessage(error)}`));
  };

  return (
    <>
      <div className="sidebar-header-row">
        <span className="pill">Agnes Studio</span>
        <span className="meta">{durationSec.toFixed(1)}s · {clip.id}</span>
      </div>

      <div className="option-group">
        <div className="label">Generation mode</div>
        <div className="select-wrap">
          <select className="select" value={mode} onChange={(e) => setSource(e.target.value as SidebarMode)}>
            {SOURCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <span className="select-chevron">▾</span>
        </div>
        <div className="select-desc">{SOURCES.find((item) => item.value === mode)?.desc}</div>
      </div>

      {mode === "textToImage" ? (
        <TextToImagePanel
          prompt={clip.imagePrompt ?? ""}
          size={imageSize}
          generating={imageGenerating}
          generatedImage={generatedImage}
          onPromptChange={(value) => updateClip(clip.id, { imagePrompt: value })}
          onSizeChange={setImageSize}
          onGenerate={onGenerateImage}
          onAddToLookbook={(url) => {
            addLookbook(url);
            toast.success("Image added to lookbook");
          }}
          onUseAsStartImage={onUseGeneratedImage}
        />
      ) : mode === "library" ? (
        <SavedClipPicker
          currentVideoUrl={clip.videoUrl}
          onPick={(saved) => updateClip(clip.id, {
            source: "library",
            videoUrl: saved.videoUrl,
            status: "ready",
            generationTaskId: undefined,
            model: saved.model ?? undefined,
            prompt: saved.prompt ?? undefined,
            lipSyncTaskId: undefined,
            lipSyncStatus: undefined,
            lipSyncSourceVideoUrl: undefined,
            lipSyncModel: saved.lipSyncModel ?? undefined,
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
                lipSyncTaskId: undefined,
                lipSyncStatus: undefined,
                lipSyncSourceVideoUrl: undefined,
                lipSyncModel: undefined,
                lastError: undefined,
              })}>Clear clip</button>
            )}
          </div>
        </>
      )}

      {clip.videoUrl && audioUrl && (
        <div className="option-group lipsync-panel">
          <div className="label">Manual music lip-sync</div>
          <div className="select-desc">Song audio {clip.start.toFixed(2)}s–{clip.end.toFixed(2)}s</div>
          <button
            type="button"
            className="btn w-full lipsync-btn"
            onClick={onLipSync}
            disabled={isLipSyncing}
          >
            {isLipSyncing ? "Lip-syncing…" : "Lip-sync to song segment"}
          </button>
          <div className="select-desc">Starts only when you click this button. The original uploaded song stays the final soundtrack.</div>
        </div>
      )}

      {clip.lastError && (
        <div className="error-card">
          <div className="error-title">Last attempt</div>
          <div className="error-message">{clip.lastError}</div>
        </div>
      )}
    </>
  );
}

function TextToImagePanel({
  prompt,
  size,
  generating,
  generatedImage,
  onPromptChange,
  onSizeChange,
  onGenerate,
  onAddToLookbook,
  onUseAsStartImage,
}: {
  prompt: string;
  size: string;
  generating: boolean;
  generatedImage: SavedImage | null;
  onPromptChange: (value: string) => void;
  onSizeChange: (value: string) => void;
  onGenerate: () => void;
  onAddToLookbook: (url: string) => void;
  onUseAsStartImage: () => void;
}) {
  return (
    <>
      <div className="option-group">
        <div className="label">Image prompt</div>
        <textarea
          className="prompt"
          placeholder="Describe the character, setting, wardrobe, lighting, lens, composition, and visual style…"
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
        />
      </div>
      <div className="option-group">
        <div className="label">Image size</div>
        <div className="select-wrap">
          <select className="select" value={size} onChange={(e) => onSizeChange(e.target.value)}>
            <option value="1536x864">Landscape · 1536×864</option>
            <option value="1024x1024">Square · 1024×1024</option>
            <option value="864x1536">Portrait · 864×1536</option>
            <option value="1024x768">Landscape · 1024×768</option>
            <option value="768x1024">Portrait · 768×1024</option>
          </select>
          <span className="select-chevron">▾</span>
        </div>
      </div>
      <div className="sidebar-footer">
        <button className="generate-btn" onClick={onGenerate} disabled={generating || !prompt.trim()}>
          {generating ? "Generating image with Agnes…" : "Generate Image with Agnes"}
        </button>
      </div>
      {generatedImage && (
        <div className="generated-image-card">
          <img className="generated-image-preview" src={generatedImage.url} alt={generatedImage.name || "Generated image"} />
          <div className="generated-image-meta">Saved to Library → Images</div>
          <div className="generated-image-actions">
            <button type="button" className="btn ghost" onClick={() => onAddToLookbook(generatedImage.url)}>Add to Lookbook</button>
            <button type="button" className="btn" onClick={onUseAsStartImage}>Use as Start Image</button>
          </div>
        </div>
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
