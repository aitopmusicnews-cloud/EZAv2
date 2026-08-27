import { useMemo, useState, type ChangeEvent, type DragEvent } from "react";
import { getErrorMessage, type DirectorShot, type ReferenceAsset } from "@mvs/shared";
import { uploadSong } from "../lib/api.js";
import { useStore } from "../lib/store.js";
import { AssetUploader } from "./AssetUploader.js";
import { compileDirectorImageRequest } from "../lib/directorPrompts.js";
import {
  approveAllReadyDirectorClips,
  approveAllStoryboardImages,
  enqueueDirectorVideos,
  generateStoryboardImage,
  generateStoryboardImages,
  regenerateDirectorVideo,
  renderDirectorFinal,
} from "../lib/directorActions.js";
import "../styles/director.css";

const CAMERA_OPTIONS = [
  "slow cinematic push-in",
  "slow dolly forward",
  "smooth lateral tracking",
  "low-angle push-in",
  "controlled handheld drift",
  "gentle orbit around the subject",
  "locked-off cinematic composition",
];
const FRAMING_OPTIONS = ["wide", "medium", "medium close-up", "close-up", "detail insert"];
const STEP_LABELS = ["1. Song", "2. Plan", "3. Images", "4. Clips", "5. Final"] as const;

export function DirectorWorkspace({ onOpenAdvanced }: { onOpenAdvanced: () => void }) {
  const songFilename = useStore((s) => s.songFilename);
  const analysis = useStore((s) => s.analysis);
  const directorVision = useStore((s) => s.directorVision);
  const directorPlan = useStore((s) => s.directorPlan);
  const directorStage = useStore((s) => s.directorStage);
  const directorFinalUrl = useStore((s) => s.directorFinalUrl);
  const clips = useStore((s) => s.clips);
  const bible = useStore((s) => s.productionBible) ?? {};
  const referenceAssets = useStore((s) => s.referenceAssets);
  const setDirectorVision = useStore((s) => s.setDirectorVision);
  const buildDirectorPlan = useStore((s) => s.buildDirectorPlan);
  const updateDirectorShot = useStore((s) => s.updateDirectorShot);
  const approveDirectorPlan = useStore((s) => s.approveDirectorPlan);
  const approveDirectorImage = useStore((s) => s.approveDirectorImage);
  const approveDirectorClip = useStore((s) => s.approveDirectorClip);
  const setDirectorStage = useStore((s) => s.setDirectorStage);
  const unloadSong = useStore((s) => s.unloadSong);
  const loadSong = useStore((s) => s.loadSong);
  const setProductionBible = useStore((s) => s.setProductionBible);
  const updateDirectorBible = useStore((s) => s.updateDirectorBible);
  const upsertReferenceAsset = useStore((s) => s.upsertReferenceAsset);

  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [referenceStatus, setReferenceStatus] = useState<string | null>(null);

  const clipMap = useMemo(() => new Map(clips.map((clip) => [clip.id, clip])), [clips]);
  const imagesApproved = Boolean(directorPlan?.shots.every((shot) => shot.imageApproved && shot.imageUrl));
  const videosApproved = Boolean(directorPlan?.shots.every((shot) => shot.videoApproved));
  const allImagesReady = Boolean(directorPlan?.shots.every((shot) => shot.imageStatus === "ready" && shot.imageUrl));
  const allVideosReady = Boolean(directorPlan?.shots.every((shot) => {
    const clip = clipMap.get(shot.clipId);
    return clip?.status === "ready" && Boolean(clip.videoUrl);
  }));

  const clearError = () => setError(null);

  const handleSong = async (file: File) => {
    clearError();
    setUploadStatus("Uploading and analyzing your song…");
    try {
      const result = await uploadSong(file);
      loadSong(result.id, result.audioUrl, result.analysis, result.filename ?? file.name);
      setUploadStatus(null);
    } catch (err) {
      setUploadStatus(null);
      setError(`Song upload failed: ${getErrorMessage(err)}`);
    }
  };

  const onDropSong = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) void handleSong(file);
  };

  const onPickSong = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleSong(file);
    event.target.value = "";
  };

  const addReference = (role: ReferenceAsset["role"], url: string) => {
    const asset: ReferenceAsset = {
      id: `ref-${role}-${crypto.randomUUID().slice(0, 8)}`,
      url,
      role,
      locked: true,
      name: role === "character" ? "Director artist reference" : "Director style reference",
    };
    upsertReferenceAsset(asset);
    if (role === "character") {
      setProductionBible({ ...bible, characterReferenceAssetIds: [asset.id] });
    }
  };

  const createPlan = () => {
    clearError();
    const plan = buildDirectorPlan();
    if (!plan) setError("Upload a song before creating the video plan.");
  };

  const generateImages = async () => {
    setBusy("images");
    clearError();
    try {
      await generateStoryboardImages((done, total) => setProgress(total ? `Generating storyboard image ${done + 1} of ${total}…` : null));
      setProgress(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const regenerateImage = async (shotId: string) => {
    setBusy(`image:${shotId}`);
    clearError();
    try {
      await generateStoryboardImage(shotId);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const generateVideos = () => {
    clearError();
    try {
      enqueueDirectorVideos();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const regenerateVideo = (shotId: string) => {
    clearError();
    try {
      regenerateDirectorVideo(shotId);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const renderFinal = async () => {
    setBusy("render");
    clearError();
    setProgress("Submitting final render…");
    try {
      await renderDirectorFinal((job) => {
        if (job.state === "queued") setProgress("Final render queued…");
        if (job.state === "running") setProgress("Rendering approved music video…");
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const canOpenStep = (index: number) => {
    if (index === 0) return true;
    if (index === 1) return Boolean(analysis && directorPlan);
    if (index === 2) return Boolean(directorPlan?.approvedAt);
    if (index === 3) return imagesApproved || directorStage === "clips" || directorStage === "final";
    return Boolean(directorFinalUrl);
  };

  const stageForIndex = ["song", "plan", "images", "clips", "final"] as const;

  return (
    <div className="director-app">
      <header className="director-header">
        <div>
          <div className="director-kicker">EZAv2 + BeatSync</div>
          <h1>AI Music Video Director</h1>
        </div>
        <button type="button" className="btn ghost" onClick={onOpenAdvanced}>Advanced Editor</button>
      </header>

      <nav className="director-stepper" aria-label="Music video creation steps">
        {STEP_LABELS.map((label, index) => (
          <button
            type="button"
            key={label}
            disabled={!canOpenStep(index)}
            className={directorStage === stageForIndex[index] ? "active" : ""}
            onClick={() => setDirectorStage(stageForIndex[index]!)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && <div className="director-alert"><strong>Needs attention:</strong> {error}<button type="button" onClick={clearError}>×</button></div>}
      {progress && <div className="director-progress">{progress}</div>}

      <main className="director-main">
        {directorStage === "song" && (
          <SongStep
            songFilename={songFilename}
            analysis={analysis}
            vision={directorVision}
            setVision={setDirectorVision}
            uploadStatus={uploadStatus}
            dragOver={dragOver}
            setDragOver={setDragOver}
            onDrop={onDropSong}
            onPick={onPickSong}
            onChangeSong={unloadSong}
            onCreatePlan={createPlan}
            bible={bible}
            references={referenceAssets}
            addReference={addReference}
            referenceStatus={referenceStatus}
            setReferenceStatus={setReferenceStatus}
          />
        )}

        {directorStage === "plan" && directorPlan && (
          <PlanStep
            plan={directorPlan}
            bible={bible}
            references={referenceAssets}
            onUpdateBible={updateDirectorBible}
            onUpdateShot={updateDirectorShot}
            onRegeneratePlan={createPlan}
            onApprove={() => approveDirectorPlan()}
            onBack={() => setDirectorStage("song")}
          />
        )}

        {directorStage === "images" && directorPlan && (
          <ImagesStep
            plan={directorPlan}
            busy={busy}
            onGenerate={generateImages}
            onRegenerate={regenerateImage}
            onApprove={(id: string, approved: boolean) => approveDirectorImage(id, approved)}
            onApproveAll={approveAllStoryboardImages}
            onEditPlan={() => setDirectorStage("plan")}
            onGenerateVideos={generateVideos}
            allReady={allImagesReady}
            allApproved={imagesApproved}
          />
        )}

        {directorStage === "clips" && directorPlan && (
          <ClipsStep
            plan={directorPlan}
            clipMap={clipMap}
            onApprove={(id: string, approved: boolean) => approveDirectorClip(id, approved)}
            onApproveAll={approveAllReadyDirectorClips}
            onRegenerate={regenerateVideo}
            onBack={() => setDirectorStage("images")}
            onGenerateMissing={generateVideos}
            onRender={() => void renderFinal()}
            allReady={allVideosReady}
            allApproved={videosApproved}
            rendering={busy === "render"}
          />
        )}

        {directorStage === "final" && (
          <FinalStep finalUrl={directorFinalUrl} onBack={() => setDirectorStage("clips")} onAdvanced={onOpenAdvanced} />
        )}
      </main>
    </div>
  );
}

function SongStep({
  songFilename, analysis, vision, setVision, uploadStatus, dragOver, setDragOver, onDrop, onPick, onChangeSong, onCreatePlan,
  bible, references, addReference, referenceStatus, setReferenceStatus,
}: any) {
  const character = references.find((asset: ReferenceAsset) => bible.characterReferenceAssetIds?.includes(asset.id));
  const styleRefs = references.filter((asset: ReferenceAsset) => asset.role === "style" && asset.locked);
  return (
    <section className="director-panel director-song-step">
      <div className="director-section-heading">
        <span className="director-step-number">1</span>
        <div><h2>Start with your song</h2><p>BeatSync handles the directing and prompt writing. Your vision is optional.</p></div>
      </div>

      {!analysis ? (
        <label className={`director-song-drop${dragOver ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
          <input type="file" accept="audio/*" hidden onChange={onPick} />
          <strong>{uploadStatus ?? "Upload MP3 / WAV"}</strong>
          <span>Drop a song here or click to choose</span>
        </label>
      ) : (
        <div className="director-song-loaded">
          <div><strong>{songFilename ?? "Loaded song"}</strong><span>{analysis.bpm.toFixed(0)} BPM · {analysis.key} · {formatTime(analysis.duration)}</span></div>
          <button type="button" className="btn ghost" onClick={onChangeSong}>Change Song</button>
        </div>
      )}

      <label className="director-field">
        <span>Vision <em>optional</em></span>
        <textarea value={vision} onChange={(e) => setVision(e.target.value)} placeholder="Example: Luxury nighttime performance video with exotic cars, neon city light, confident fashion energy." />
        <small>Write one simple idea. BeatSync expands it into the treatment, shots, camera directions, and Agnes prompts.</small>
      </label>

      <details className="director-details">
        <summary>Artist & style references <span>optional</span></summary>
        <div className="director-reference-grid">
          <AssetUploader className="director-reference-upload" onUploaded={(url) => addReference("character", url)} onStatus={setReferenceStatus}>
            {character?.url ? <img src={character.url} alt="Artist reference" /> : <div><strong>+ Artist Reference</strong><span>Keep the main artist consistent</span></div>}
          </AssetUploader>
          <AssetUploader className="director-reference-upload" onUploaded={(url) => addReference("style", url)} onStatus={setReferenceStatus}>
            {styleRefs[0]?.url ? <img src={styleRefs[0].url} alt="Style reference" /> : <div><strong>+ Style Reference</strong><span>Optional look / lighting reference</span></div>}
          </AssetUploader>
        </div>
        {referenceStatus && <small>{referenceStatus}</small>}
      </details>

      <button type="button" className="director-primary" disabled={!analysis} onClick={onCreatePlan}>Create Video Plan</button>
    </section>
  );
}

function PlanStep({ plan, bible, references, onUpdateBible, onUpdateShot, onRegeneratePlan, onApprove, onBack }: any) {
  return (
    <section className="director-panel">
      <div className="director-section-heading">
        <span className="director-step-number">2</span>
        <div><h2>Review the plan before Agnes generates anything</h2><p>Change the idea, camera, framing, location, or hero shots in plain English.</p></div>
      </div>
      <div className="director-bible">
        <div className="director-subheading">
          <div><h3>Production Bible</h3><p>BeatSync suggested these project rules. Edit anything before approving. Nothing here is a fixed preset.</p></div>
          <span className="director-auto-badge">Project-specific</span>
        </div>
        <div className="director-control-grid director-bible-grid">
          <label><span>Artist</span><textarea value={bible.characterProfile ?? ""} onChange={(e) => onUpdateBible({ characterProfile: e.target.value || undefined })} placeholder="Optional — describe the recurring artist only if this project needs one." /></label>
          <label><span>Wardrobe</span><textarea value={bible.wardrobeProfile ?? ""} onChange={(e) => onUpdateBible({ wardrobeProfile: e.target.value || undefined })} placeholder="Wardrobe identity and when it may change." /></label>
          <label><span>Vehicle</span><textarea value={bible.vehicleProfile ?? ""} onChange={(e) => onUpdateBible({ vehicleProfile: e.target.value || undefined })} placeholder="Optional — leave blank when the video has no recurring vehicle." /></label>
          <label><span>Location</span><textarea value={bible.locationProfile ?? ""} onChange={(e) => onUpdateBible({ locationProfile: e.target.value || undefined })} placeholder="Locations, environment, time of day, and geography." /></label>
          <label><span>Visual Style</span><textarea value={bible.stylePrompt ?? ""} onChange={(e) => onUpdateBible({ stylePrompt: e.target.value || undefined })} /></label>
          <label><span>Color Palette</span><textarea value={bible.colorPalette ?? ""} onChange={(e) => onUpdateBible({ colorPalette: e.target.value || undefined })} /></label>
          <label className="director-wide-field"><span>Continuity</span><textarea value={bible.continuityPrompt ?? ""} onChange={(e) => onUpdateBible({ continuityPrompt: e.target.value || undefined })} /></label>
          <label className="director-wide-field"><span>Global Negative Prompt</span><textarea value={bible.negativePrompt ?? ""} onChange={(e) => onUpdateBible({ negativePrompt: e.target.value || undefined })} placeholder="Required — things Agnes must avoid across every image and video in this project." /><small>Applied to every Agnes generation, then merged with shot-specific and spatial negatives without duplicates.</small></label>
        </div>
        <div className="director-spatial-summary">
          <div><span>Spatial Rules</span><strong>{bible.defaultSpatialLock ? "Custom project lock" : "Auto / None"}</strong></div>
          <small>No vehicle, seat, traffic, or camera geometry is forced by default. Add a spatial lock only when a specific scene needs one; detailed locks remain in Advanced Editor.</small>
        </div>
        <div className="director-reference-summary">
          <span>{references.filter((asset: ReferenceAsset) => asset.locked).length} locked reference(s)</span>
          <small>Artist, wardrobe, vehicle, location, and style references are used only when you add or lock them.</small>
        </div>
      </div>

      <div className="director-treatment">
        <h3>{plan.treatment.title}</h3>
        <p>{plan.treatment.concept}</p>
        <div><span>Style</span><strong>{plan.treatment.style}</strong></div>
        <div><span>Pacing</span><strong>{plan.treatment.pacing}</strong></div>
      </div>
      <div className="director-shot-list">
        {plan.shots.map((shot: DirectorShot, index: number) => {
          const rawPrompt = compileDirectorImageRequest(shot, bible, references).promptText;
          return (
            <article className={`director-shot-card${shot.hero ? " hero" : ""}`} key={shot.id}>
              <div className="director-shot-head">
                <div><span className="mono">SHOT {String(index + 1).padStart(2, "0")}</span><strong>{shot.role}</strong></div>
                <div className="director-shot-meta">{formatRange(shot.start, shot.end)} · {shot.sectionLabel}{shot.hero ? " · ★ HERO" : ""}</div>
              </div>
              <label className="director-field compact"><span>Idea</span><textarea value={shot.idea} onChange={(e) => onUpdateShot(shot.id, { idea: e.target.value })} /></label>
              <div className="director-control-grid">
                <label><span>Camera</span><select value={shot.camera} onChange={(e) => onUpdateShot(shot.id, { camera: e.target.value })}>{CAMERA_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label><span>Framing</span><select value={shot.framing} onChange={(e) => onUpdateShot(shot.id, { framing: e.target.value })}>{FRAMING_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label><span>Mood</span><input value={shot.mood} onChange={(e) => onUpdateShot(shot.id, { mood: e.target.value })} /></label>
                <label><span>Location / world</span><input value={shot.location} onChange={(e) => onUpdateShot(shot.id, { location: e.target.value })} /></label>
              </div>
              <label className="director-hero-toggle"><input type="checkbox" checked={shot.hero} onChange={(e) => onUpdateShot(shot.id, { hero: e.target.checked })} /> Hero shot</label>
              <details className="director-advanced-prompt"><summary>Advanced · Raw Agnes Prompt</summary><pre>{rawPrompt}</pre></details>
            </article>
          );
        })}
      </div>
      <div className="director-actions">
        <button type="button" className="btn ghost" onClick={onBack}>Back</button>
        <button type="button" className="btn" onClick={onRegeneratePlan}>Regenerate Plan</button>
        <button type="button" className="director-primary" disabled={!bible.negativePrompt?.trim()} onClick={onApprove}>Approve Production Bible + Plan</button>
      </div>
    </section>
  );
}

function ImagesStep({ plan, busy, onGenerate, onRegenerate, onApprove, onApproveAll, onEditPlan, onGenerateVideos, allReady, allApproved }: any) {
  const readyCount = plan.shots.filter((shot: DirectorShot) => shot.imageStatus === "ready" && shot.imageUrl).length;
  const approvedCount = plan.shots.filter((shot: DirectorShot) => shot.imageApproved).length;
  return (
    <section className="director-panel">
      <div className="director-section-heading"><span className="director-step-number">3</span><div><h2>Approve storyboard images</h2><p>See the visual direction before spending video-generation credits.</p></div></div>
      <div className="director-status-line"><span>{readyCount}/{plan.shots.length} images ready</span><span>{approvedCount}/{plan.shots.length} approved</span></div>
      {!allReady && <button type="button" className="director-primary" disabled={busy === "images"} onClick={() => void onGenerate()}>{busy === "images" ? "Generating Images…" : "Generate Storyboard Images"}</button>}
      <div className="director-storyboard-grid">
        {plan.shots.map((shot: DirectorShot, index: number) => (
          <article className={`director-image-card${shot.imageApproved ? " approved" : ""}`} key={shot.id}>
            <div className="director-image-frame">
              {shot.imageUrl ? <img src={shot.imageUrl} alt={`Storyboard shot ${index + 1}`} /> : <div className="director-image-placeholder">{shot.imageStatus === "generating" ? "Generating…" : "No image yet"}</div>}
              {shot.hero && <span className="director-badge">★ HERO</span>}
            </div>
            <div className="director-card-body"><strong>{index + 1}. {shot.role}</strong><p>{shot.idea}</p><small>{formatRange(shot.start, shot.end)} · {shot.sectionLabel}</small></div>
            {shot.imageError && <div className="director-card-error">{shot.imageError}</div>}
            <div className="director-card-actions">
              <button type="button" className="btn" disabled={!shot.imageUrl} onClick={() => onApprove(shot.id, !shot.imageApproved)}>{shot.imageApproved ? "✓ Image Approved" : "Approve Image"}</button>
              <button type="button" className="btn ghost" disabled={busy === `image:${shot.id}`} onClick={() => void onRegenerate(shot.id)}>Regenerate Image</button>
            </div>
          </article>
        ))}
      </div>
      <div className="director-actions sticky">
        <button type="button" className="btn ghost" onClick={onEditPlan}>Edit Plan</button>
        <button type="button" className="btn" disabled={!allReady} onClick={onApproveAll}>Approve All Images</button>
        <button type="button" className="director-primary" disabled={!allApproved} onClick={onGenerateVideos}>Generate Video Clips</button>
      </div>
    </section>
  );
}

function ClipsStep({ plan, clipMap, onApprove, onApproveAll, onRegenerate, onBack, onGenerateMissing, onRender, allReady, allApproved, rendering }: any) {
  const approvedCount = plan.shots.filter((shot: DirectorShot) => shot.videoApproved).length;
  return (
    <section className="director-panel">
      <div className="director-section-heading"><span className="director-step-number">4</span><div><h2>Approve generated clips</h2><p>Regenerate only the shots that need work. Approved clips stay untouched.</p></div></div>
      <div className="director-status-line"><span>{approvedCount}/{plan.shots.length} clips approved</span><span>{allReady ? "All clips ready" : "Generation still in progress"}</span></div>
      <div className="director-clip-list">
        {plan.shots.map((shot: DirectorShot, index: number) => {
          const clip = clipMap.get(shot.clipId);
          return (
            <article className={`director-clip-card${shot.videoApproved ? " approved" : ""}`} key={shot.id}>
              <div className="director-clip-preview">{clip?.videoUrl ? <video src={clip.videoUrl} controls preload="metadata" /> : <div>{clip?.status === "generating" || clip?.status === "queued" ? "Agnes is generating this clip…" : clip?.status === "failed" ? "Generation failed" : "Waiting to generate"}</div>}</div>
              <div className="director-card-body"><strong>{index + 1}. {shot.role}</strong><p>{shot.idea}</p><small>{clip?.status ?? "empty"}{clip?.lastError ? ` · ${clip.lastError}` : ""}</small></div>
              <div className="director-card-actions">
                <button type="button" className="btn" disabled={clip?.status !== "ready" || !clip.videoUrl} onClick={() => onApprove(shot.id, !shot.videoApproved)}>{shot.videoApproved ? "✓ Clip Approved" : "Approve Clip"}</button>
                <button type="button" className="btn ghost" disabled={clip?.status === "queued" || clip?.status === "generating"} onClick={() => onRegenerate(shot.id)}>Regenerate Clip</button>
              </div>
            </article>
          );
        })}
      </div>
      <div className="director-actions sticky">
        <button type="button" className="btn ghost" onClick={onBack}>Back to Images</button>
        {!allReady && <button type="button" className="btn" onClick={onGenerateMissing}>Generate Missing Clips</button>}
        <button type="button" className="btn" disabled={!allReady} onClick={onApproveAll}>Approve All Ready Clips</button>
        <button type="button" className="director-primary" disabled={!allApproved || rendering} onClick={onRender}>{rendering ? "Rendering…" : "Render Final Music Video"}</button>
      </div>
    </section>
  );
}

function FinalStep({ finalUrl, onBack, onAdvanced }: { finalUrl: string | null; onBack: () => void; onAdvanced: () => void }) {
  return (
    <section className="director-panel director-final">
      <div className="director-section-heading"><span className="director-step-number">5</span><div><h2>Your music video</h2><p>The final cut uses only the clips you approved and the original uploaded song.</p></div></div>
      {finalUrl ? <video className="director-final-video" src={finalUrl} controls /> : <div className="director-image-placeholder">No final render yet.</div>}
      <div className="director-actions">
        <button type="button" className="btn ghost" onClick={onBack}>Make Changes</button>
        <button type="button" className="btn" onClick={onAdvanced}>Open Advanced Editor</button>
        {finalUrl && <a className="director-primary link" href={finalUrl} download>Download Final Video</a>}
      </div>
    </section>
  );
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${secs}`;
}
function formatRange(start: number, end: number) { return `${formatTime(start)}–${formatTime(end)}`; }
