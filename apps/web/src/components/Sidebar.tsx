import { useEffect, useMemo, useState } from "react";
import { useStore } from "../lib/store.js";
import type { Clip, ProductionBible, ReferenceAsset, SpatialLock } from "@mvs/shared";
import { AGNES_VIDEO_MODEL, getErrorMessage } from "@mvs/shared";
import { enqueueGeneration, type GenerationSource } from "../lib/scheduler.js";
import {
  extractLastFrame,
  generateTextToImage,
  listSavedClips,
  type SavedClip,
  type SavedImage,
} from "../lib/api.js";
import {
  compileImagePrompt,
  compileNegativePrompt,
  compileVideoPrompt,
  validateSpatialLock,
} from "../lib/promptCompiler.js";
import { applyLipSyncToClip } from "../lib/lipsync.js";
import { AssetUploader } from "./AssetUploader.js";
import { toast } from "../lib/toast.js";
import "../styles/generation-tools.css";

type SidebarMode = GenerationSource | "textToImage" | "library";
type SpatialPresetKey = "none" | "usMirror" | "usExterior" | "stationary";
type SceneSpatialPresetKey = "project" | SpatialPresetKey;

const SOURCES: Array<{ value: SidebarMode; label: string; desc: string }> = [
  { value: "textToVideo", label: "Text → Video", desc: "Describe the scene and let Agnes create the visual." },
  { value: "textToImage", label: "Text → Image", desc: "Create a reusable still image with Agnes before animating it." },
  { value: "imageToVideo", label: "Image → Video", desc: "Animate a character or lookbook reference with Agnes." },
  { value: "keyframeToVideo", label: "Keyframe → Video", desc: "Transition between a start and end reference frame." },
  { value: "library", label: "Clip library", desc: "Reuse a saved clip without launching generation." },
];

const US_MIRROR_LOCK: SpatialLock = {
  trafficSystem: "US_RIGHT_HAND",
  driveSide: "LEFT_HAND_DRIVE",
  driverSeat: "FRONT_LEFT",
  passengerSeat: "FRONT_RIGHT",
  cameraPosition: "FRONT_PASSENGER_INTERIOR",
  cameraDirection: "TOWARD_DRIVER_AND_CENTER_MIRROR",
  vehicleDirection: "FORWARD",
  competitorPosition: "BEHIND",
  competitorDirection: "SAME_DIRECTION",
  rearviewMirrorShows: "ROAD_BEHIND_AND_COMPETITORS",
  windshieldShows: "OPEN_ROAD_AHEAD",
  allowOncomingTraffic: false,
};

const US_EXTERIOR_LOCK: SpatialLock = {
  trafficSystem: "US_RIGHT_HAND",
  driveSide: "LEFT_HAND_DRIVE",
  driverSeat: "FRONT_LEFT",
  passengerSeat: "FRONT_RIGHT",
  cameraPosition: "DRIVER_SIDE_EXTERIOR",
  cameraDirection: "TOWARD_VEHICLE",
  vehicleDirection: "FORWARD",
  competitorPosition: "BEHIND",
  competitorDirection: "SAME_DIRECTION",
  windshieldShows: "OPEN_ROAD_AHEAD",
  allowOncomingTraffic: false,
};

const STATIONARY_LOCK: SpatialLock = {
  trafficSystem: "US_RIGHT_HAND",
  driveSide: "LEFT_HAND_DRIVE",
  driverSeat: "FRONT_LEFT",
  passengerSeat: "FRONT_RIGHT",
  vehicleDirection: "STATIONARY",
  competitorPosition: "NONE",
  competitorDirection: "NONE",
  allowOncomingTraffic: false,
};

export function Sidebar() {
  const selectedId = useStore((s) => s.selectedClipId);
  const clips = useStore((s) => s.clips);
  const analysis = useStore((s) => s.analysis);
  const audioUrl = useStore((s) => s.audioUrl);
  const lookbook = useStore((s) => s.lookbook);
  const characterImage = useStore((s) => s.characterImageUrl);
  const productionBible = useStore((s) => s.productionBible);
  const referenceAssets = useStore((s) => s.referenceAssets);
  const addLookbook = useStore((s) => s.addLookbook);
  const updateClip = useStore((s) => s.updateClip);
  const setProductionBible = useStore((s) => s.setProductionBible);
  const upsertReferenceAsset = useStore((s) => s.upsertReferenceAsset);
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

  const bible: ProductionBible = productionBible ?? {};
  const source: GenerationSource | "library" =
    clip.source === "imageToVideo" || clip.source === "keyframeToVideo" || clip.source === "library"
      ? clip.source
      : "textToVideo";
  const section = analysis.sections.find((s) => s.start <= clip.start && s.end >= clip.end);
  const sectionLabel = section?.label ?? "section";
  const durationSec = clip.end - clip.start;
  const energy = avgRms(analysis.rmsCurve, clip.start, clip.end, analysis.duration);
  const prompt = clip.prompt ?? "";
  const imagePrompt = clip.imagePrompt ?? "";
  const availableImages = Array.from(new Set([
    characterImage,
    ...lookbook,
    ...referenceAssets.map((asset) => asset.url),
  ].filter((v): v is string => Boolean(v))));

  const characterReference = findBibleReference(referenceAssets, bible.characterReferenceAssetIds);
  const vehicleReference = findBibleReference(referenceAssets, bible.vehicleReferenceAssetIds);
  const globalReferenceIds = [
    ...(bible.characterReferenceAssetIds ?? []),
    ...(bible.vehicleReferenceAssetIds ?? []),
  ];
  const activeReferenceIds = Array.from(new Set([...globalReferenceIds, ...(clip.referenceAssetIds ?? [])]));
  const selectedReferenceAssets = activeReferenceIds
    .map((id) => referenceAssets.find((asset) => asset.id === id))
    .filter((asset): asset is ReferenceAsset => Boolean(asset));

  const effectiveSpatialLock = clip.spatialLock ?? bible.defaultSpatialLock;
  const spatialIssues = validateSpatialLock(effectiveSpatialLock);
  const compiledVideoPrompt = compileVideoPrompt({
    scenePrompt: prompt,
    productionBible: bible,
    spatialLock: effectiveSpatialLock,
    referenceAssets: selectedReferenceAssets,
  });
  const compiledImagePrompt = compileImagePrompt({
    scenePrompt: imagePrompt,
    productionBible: bible,
    spatialLock: effectiveSpatialLock,
    referenceAssets: selectedReferenceAssets,
  });
  const compiledNegativePrompt = compileNegativePrompt({
    productionBible: bible,
    spatialLock: effectiveSpatialLock,
    negativePrompt: clip.negativePrompt,
  });
  const imageGenerationMode: "text2img" | "img2img" | "compose" =
    selectedReferenceAssets.length >= 2 ? "compose" : selectedReferenceAssets.length === 1 ? "img2img" : "text2img";

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

  const updateBible = (patch: Partial<ProductionBible>) => {
    setProductionBible({ ...bible, ...patch });
  };

  const setLockedReference = (role: "character" | "vehicle", url: string) => {
    if (!url) {
      if (role === "character") updateBible({ characterReferenceAssetIds: [] });
      else updateBible({ vehicleReferenceAssetIds: [] });
      return;
    }
    let asset = referenceAssets.find((item) => item.role === role && item.url === url);
    if (!asset) {
      asset = {
        id: `ref-${role}-${crypto.randomUUID().slice(0, 8)}`,
        url,
        role,
        locked: true,
        name: role === "character" ? "Locked character" : "Locked vehicle",
      };
      upsertReferenceAsset(asset);
    } else if (asset.locked !== true) {
      asset = { ...asset, locked: true };
      upsertReferenceAsset(asset);
    }
    if (role === "character") updateBible({ characterReferenceAssetIds: [asset.id] });
    else updateBible({ vehicleReferenceAssetIds: [asset.id] });
  };

  const setProjectSpatialPreset = (key: SpatialPresetKey) => {
    updateBible({ defaultSpatialLock: spatialPreset(key) });
  };

  const setSceneSpatialPreset = (key: SceneSpatialPresetKey) => {
    updateClip(clip.id, { spatialLock: key === "project" ? undefined : spatialPreset(key) });
  };

  const onGenerate = () => {
    if (source === "library") return;
    if (!canGenerate.ok) {
      toast.warning(canGenerate.reason);
      return;
    }
    if (spatialIssues.length) {
      toast.warning(`Fix spatial lock: ${spatialIssues[0]}`);
      return;
    }
    enqueueGeneration({
      clipId: clip.id,
      source,
      seedImageUrl: source === "textToVideo" ? "" : selectedImage ?? "",
      endImageUrl: source === "keyframeToVideo" ? endImage ?? "" : "",
      prompt: compiledVideoPrompt,
      negativePrompt: compiledNegativePrompt,
      duration: durationSec,
      sectionLabel,
      energy,
      model: AGNES_VIDEO_MODEL,
    });
  };

  const onGenerateImage = async () => {
    if (!imagePrompt.trim()) {
      toast.warning("Describe the image before generating");
      return;
    }
    if (spatialIssues.length) {
      toast.warning(`Fix spatial lock: ${spatialIssues[0]}`);
      return;
    }
    setImageGenerating(true);
    try {
      const referenceImages = selectedReferenceAssets;
      const saved = await generateTextToImage({
        promptText: compiledImagePrompt,
        size: imageSize,
        mode: imageGenerationMode,
        referenceImages,
      });
      setGeneratedImage(saved);
      updateClip(clip.id, {
        compiledPrompt: compiledImagePrompt,
        compiledNegativePrompt: compiledNegativePrompt || undefined,
      });
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

      <ProductionBiblePanel
        bible={bible}
        availableImages={availableImages}
        characterReferenceUrl={characterReference?.url}
        vehicleReferenceUrl={vehicleReference?.url}
        defaultSpatialPreset={spatialPresetKey(bible.defaultSpatialLock)}
        onCharacterReference={(url) => setLockedReference("character", url)}
        onVehicleReference={(url) => setLockedReference("vehicle", url)}
        onCharacterProfile={(value) => updateBible({ characterProfile: value })}
        onVehicleProfile={(value) => updateBible({ vehicleProfile: value })}
        onStylePrompt={(value) => updateBible({ stylePrompt: value })}
        onGlobalNegativePrompt={(value) => updateBible({ negativePrompt: value })}
        onDefaultSpatialPreset={setProjectSpatialPreset}
      />

      {mode === "textToImage" ? (
        <TextToImagePanel
          prompt={imagePrompt}
          size={imageSize}
          generating={imageGenerating}
          generatedImage={generatedImage}
          imageGenerationMode={imageGenerationMode}
          selectedReferenceAssets={selectedReferenceAssets}
          compiledPrompt={compiledImagePrompt}
          negativePrompt={compiledNegativePrompt}
          spatialIssues={spatialIssues}
          sceneSpatialPreset={clip.spatialLock === undefined ? "project" : spatialPresetKey(clip.spatialLock)}
          onSceneSpatialPreset={setSceneSpatialPreset}
          sceneNegativePrompt={clip.negativePrompt ?? ""}
          onSceneNegativePrompt={(value) => updateClip(clip.id, { negativePrompt: value })}
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

          <SceneProductionControls
            spatialPreset={clip.spatialLock === undefined ? "project" : spatialPresetKey(clip.spatialLock)}
            onSpatialPreset={setSceneSpatialPreset}
            negativePrompt={clip.negativePrompt ?? ""}
            onNegativePrompt={(value) => updateClip(clip.id, { negativePrompt: value })}
            spatialIssues={spatialIssues}
          />

          <RequestInspector
            mode={source}
            references={source === "textToVideo" ? [] : [selectedImage, source === "keyframeToVideo" ? endImage : undefined].filter((value): value is string => Boolean(value))}
            compiledPrompt={compiledVideoPrompt}
            negativePrompt={compiledNegativePrompt}
            detail={`${durationSec.toFixed(2)}s · 16:9 · Agnes Video V2.0`}
          />

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
              disabled={clip.status === "queued" || clip.status === "generating" || !canGenerate.ok || spatialIssues.length > 0}
              title={spatialIssues.length ? spatialIssues[0] : canGenerate.ok ? undefined : canGenerate.reason}
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

function ProductionBiblePanel({
  bible,
  availableImages,
  characterReferenceUrl,
  vehicleReferenceUrl,
  defaultSpatialPreset,
  onCharacterReference,
  onVehicleReference,
  onCharacterProfile,
  onVehicleProfile,
  onStylePrompt,
  onGlobalNegativePrompt,
  onDefaultSpatialPreset,
}: {
  bible: ProductionBible;
  availableImages: string[];
  characterReferenceUrl?: string;
  vehicleReferenceUrl?: string;
  defaultSpatialPreset: SpatialPresetKey;
  onCharacterReference: (url: string) => void;
  onVehicleReference: (url: string) => void;
  onCharacterProfile: (value: string) => void;
  onVehicleProfile: (value: string) => void;
  onStylePrompt: (value: string) => void;
  onGlobalNegativePrompt: (value: string) => void;
  onDefaultSpatialPreset: (value: SpatialPresetKey) => void;
}) {
  return (
    <details className="option-group production-bible" open>
      <summary className="label">Production Bible</summary>
      <div className="select-desc">Project-wide identity, vehicle, geometry, style, and negative rules automatically compile into every Agnes request.</div>

      <div className="field-stack">
        <label className="label" htmlFor="locked-character-reference">Locked character reference</label>
        <ReferenceSelect id="locked-character-reference" value={characterReferenceUrl ?? ""} images={availableImages} onChange={onCharacterReference} emptyLabel="No locked character" />
      </div>

      <div className="field-stack">
        <label className="label" htmlFor="locked-vehicle-reference">Locked vehicle reference</label>
        <ReferenceSelect id="locked-vehicle-reference" value={vehicleReferenceUrl ?? ""} images={availableImages} onChange={onVehicleReference} emptyLabel="No locked vehicle" />
      </div>

      <div className="field-stack">
        <div className="label">Character lock description</div>
        <textarea className="prompt compact" value={bible.characterProfile ?? ""} onChange={(e) => onCharacterProfile(e.target.value)} placeholder="Exact recurring identity, age, hair, skin tone, wardrobe…" />
      </div>

      <div className="field-stack">
        <div className="label">Vehicle lock description</div>
        <textarea className="prompt compact" value={bible.vehicleProfile ?? ""} onChange={(e) => onVehicleProfile(e.target.value)} placeholder="Exact recurring vehicle, paint, wheels, interior orientation…" />
      </div>

      <div className="field-stack">
        <div className="label">Project style</div>
        <textarea className="prompt compact" value={bible.stylePrompt ?? ""} onChange={(e) => onStylePrompt(e.target.value)} placeholder="Cinematic realism, lighting palette, aspect treatment…" />
      </div>

      <div className="field-stack">
        <div className="label">Global negative prompt</div>
        <textarea className="prompt compact" value={bible.negativePrompt ?? ""} onChange={(e) => onGlobalNegativePrompt(e.target.value)} placeholder="Duplicate protagonist, inconsistent face, wrong car…" />
      </div>

      <div className="field-stack">
        <div className="label">Default spatial lock</div>
        <SpatialPresetSelect value={defaultSpatialPreset} includeProject={false} onChange={(value) => onDefaultSpatialPreset(value as SpatialPresetKey)} />
      </div>
    </details>
  );
}

function TextToImagePanel({
  prompt,
  size,
  generating,
  generatedImage,
  imageGenerationMode,
  selectedReferenceAssets,
  compiledPrompt,
  negativePrompt,
  spatialIssues,
  sceneSpatialPreset,
  onSceneSpatialPreset,
  sceneNegativePrompt,
  onSceneNegativePrompt,
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
  imageGenerationMode: "text2img" | "img2img" | "compose";
  selectedReferenceAssets: ReferenceAsset[];
  compiledPrompt: string;
  negativePrompt: string;
  spatialIssues: string[];
  sceneSpatialPreset: SceneSpatialPresetKey;
  onSceneSpatialPreset: (value: SceneSpatialPresetKey) => void;
  sceneNegativePrompt: string;
  onSceneNegativePrompt: (value: string) => void;
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

      <SceneProductionControls
        spatialPreset={sceneSpatialPreset}
        onSpatialPreset={onSceneSpatialPreset}
        negativePrompt={sceneNegativePrompt}
        onNegativePrompt={onSceneNegativePrompt}
        spatialIssues={spatialIssues}
      />

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

      <RequestInspector
        mode={imageGenerationMode}
        references={selectedReferenceAssets.map((asset) => `${asset.role}: ${asset.url}`)}
        compiledPrompt={compiledPrompt}
        negativePrompt={negativePrompt}
        detail={size}
      />

      <div className="sidebar-footer">
        <button className="generate-btn" onClick={onGenerate} disabled={generating || !prompt.trim() || spatialIssues.length > 0}>
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

function SceneProductionControls({
  spatialPreset,
  onSpatialPreset,
  negativePrompt,
  onNegativePrompt,
  spatialIssues,
}: {
  spatialPreset: SceneSpatialPresetKey;
  onSpatialPreset: (value: SceneSpatialPresetKey) => void;
  negativePrompt: string;
  onNegativePrompt: (value: string) => void;
  spatialIssues: string[];
}) {
  return (
    <div className="option-group production-controls">
      <div className="label">Spatial lock</div>
      <SpatialPresetSelect value={spatialPreset} includeProject onChange={(value) => onSpatialPreset(value as SceneSpatialPresetKey)} />
      <div className="select-desc">Use the U.S. mirror preset for left-hand-drive interior shots with competitors behind you.</div>

      <div className="label production-label-gap">Scene negative prompt</div>
      <textarea
        className="prompt compact"
        value={negativePrompt}
        onChange={(e) => onNegativePrompt(e.target.value)}
        placeholder="Scene-specific things Agnes must avoid…"
      />

      {spatialIssues.length > 0 && (
        <div className="error-card spatial-warning">
          <div className="error-title">Spatial conflict</div>
          {spatialIssues.map((issue) => <div className="error-message" key={issue}>{issue}</div>)}
        </div>
      )}
    </div>
  );
}

function RequestInspector({
  mode,
  references,
  compiledPrompt,
  negativePrompt,
  detail,
}: {
  mode: string;
  references: string[];
  compiledPrompt: string;
  negativePrompt: string;
  detail: string;
}) {
  return (
    <details className="option-group request-inspector">
      <summary className="label">What Agnes will receive</summary>
      <div className="context-card request-card">
        <div className="row"><span>Mode</span><span>{mode}</span></div>
        <div className="row"><span>References</span><span>{references.length}</span></div>
        <div className="row"><span>Output</span><span>{detail}</span></div>
      </div>
      {references.length > 0 && <pre className="request-code">{references.join("\n")}</pre>}
      <div className="label production-label-gap">Compiled prompt</div>
      <pre className="request-code">{compiledPrompt || "No scene prompt yet."}</pre>
      <div className="label production-label-gap">Compiled negative prompt</div>
      <pre className="request-code">{negativePrompt || "None"}</pre>
    </details>
  );
}

function ReferenceSelect({
  id,
  value,
  images,
  onChange,
  emptyLabel,
}: {
  id: string;
  value: string;
  images: string[];
  onChange: (value: string) => void;
  emptyLabel: string;
}) {
  return (
    <div className="select-wrap">
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{emptyLabel}</option>
        {images.map((url, index) => <option key={url} value={url}>Reference {index + 1}</option>)}
      </select>
      <span className="select-chevron">▾</span>
    </div>
  );
}

function SpatialPresetSelect({
  value,
  includeProject,
  onChange,
}: {
  value: SceneSpatialPresetKey | SpatialPresetKey;
  includeProject: boolean;
  onChange: (value: SceneSpatialPresetKey) => void;
}) {
  return (
    <div className="select-wrap">
      <select className="select" value={value} onChange={(e) => onChange(e.target.value as SceneSpatialPresetKey)}>
        {includeProject && <option value="project">Use project default</option>}
        <option value="none">No spatial lock</option>
        <option value="usMirror">U.S. left-hand drive · passenger camera · rivals behind in mirror</option>
        <option value="usExterior">U.S. left-hand drive · exterior tracking · rivals behind</option>
        <option value="stationary">U.S. left-hand drive · stationary vehicle</option>
      </select>
      <span className="select-chevron">▾</span>
    </div>
  );
}

function spatialPreset(key: SpatialPresetKey): SpatialLock | undefined {
  if (key === "usMirror") return { ...US_MIRROR_LOCK };
  if (key === "usExterior") return { ...US_EXTERIOR_LOCK };
  if (key === "stationary") return { ...STATIONARY_LOCK };
  return undefined;
}

function spatialPresetKey(lock?: SpatialLock | null): SpatialPresetKey {
  if (!lock || Object.keys(lock).length === 0) return "none";
  if (lock.vehicleDirection === "STATIONARY") return "stationary";
  if (lock.cameraPosition === "FRONT_PASSENGER_INTERIOR" && lock.rearviewMirrorShows === "ROAD_BEHIND_AND_COMPETITORS") return "usMirror";
  if (lock.cameraPosition === "DRIVER_SIDE_EXTERIOR") return "usExterior";
  return "none";
}

function findBibleReference(referenceAssets: ReferenceAsset[], ids?: string[]): ReferenceAsset | undefined {
  const first = ids?.[0];
  return first ? referenceAssets.find((asset) => asset.id === first) : undefined;
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
