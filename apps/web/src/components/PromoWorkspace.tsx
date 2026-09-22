import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getErrorMessage } from "@mvs/shared";
import {
  uploadAudioAsset,
  uploadImage,
  uploadVideo,
  getPromoRenderJob,
  submitPromoRender,
  type PromoRenderRequest,
  type PromoRenderJob,
} from "../lib/api.js";
import "../styles/promo.css";

const MAX_SCENES = 10;
const ACTIVE_PROMO_RENDER_KEY = "ezav2-active-promo-render";
const PROMO_POLL_INTERVAL_MS = 3000;
type Motion = "static" | "push-in" | "zoom-out" | "pan-left" | "pan-right";
type Fit = "cover" | "contain";
type Position = "top" | "center" | "bottom";
type Scene = {
  id: string; name: string; url: string; kind: "image" | "video"; duration: number;
  motion: Motion; fit: Fit; focalX: number; focalY: number; uiSafe: boolean;
  text: string; textIn: number; textOut: number; textPosition: Position; productionNotes: string;
};
type AudioAsset = { name: string; url: string };

const newId = () => `promo-${crypto.randomUUID().slice(0, 8)}`;
const isImage = (f: File) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name);
const isVideo = (f: File) => f.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(f.name);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForPromoRender(
  renderId: string,
  onUpdate: (job: PromoRenderJob) => void,
  isCancelled: () => boolean = () => false,
): Promise<{ url: string } | null> {
  while (!isCancelled()) {
    const job = await getPromoRenderJob(renderId);
    if (isCancelled()) return null;
    onUpdate(job);
    if (job.state === "succeeded" && job.url) {
      localStorage.removeItem(ACTIVE_PROMO_RENDER_KEY);
      return { url: job.url };
    }
    if (job.state === "failed") {
      localStorage.removeItem(ACTIVE_PROMO_RENDER_KEY);
      throw new Error(job.error ?? "promo render failed");
    }
    await sleep(PROMO_POLL_INTERVAL_MS);
  }
  return null;
}

export function PromoWorkspace() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9" | "4:5">("9:16");
  const [music, setMusic] = useState<AudioAsset | null>(null);
  const [voice, setVoice] = useState<AudioAsset | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.72);
  const [voiceVolume, setVoiceVolume] = useState(1);
  const [duckMusic, setDuckMusic] = useState(true);
  const [voiceScript, setVoiceScript] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] = useState<string | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  const selected = scenes.find((s) => s.id === selectedId) ?? scenes[0] ?? null;
  const totalDuration = useMemo(() => scenes.reduce((n, s) => n + s.duration, 0), [scenes]);
  const onTarget = totalDuration >= 30 && totalDuration <= 35;
  const renderInProgress = !!renderStatus && !renderUrl;
  const patch = (id: string, p: Partial<Scene>) => setScenes((xs) => xs.map((s) => s.id === id ? { ...s, ...p } : s));

  useEffect(() => {
    const renderId = localStorage.getItem(ACTIVE_PROMO_RENDER_KEY);
    if (!renderId) return;

    let cancelled = false;
    setError(null);
    setRenderStatus("Reconnecting to render…");

    void waitForPromoRender(
      renderId,
      (job) => {
        if (job.state === "running") setRenderStatus("Rendering promo…");
        else if (job.state === "queued") setRenderStatus("Queued…");
      },
      () => cancelled,
    ).then((out) => {
      if (cancelled || !out) return;
      setRenderUrl(out.url);
      setRenderStatus("Render complete");
    }).catch((e) => {
      if (cancelled) return;
      const message = getErrorMessage(e);
      if (message.includes("render job not found")) {
        localStorage.removeItem(ACTIVE_PROMO_RENDER_KEY);
        setError("The previous render job is no longer available. Please export again.");
      } else {
        setError(message);
      }
      setRenderStatus(null);
    });

    return () => { cancelled = true; };
  }, []);

  async function addScene(file: File, replaceId?: string) {
    if (!isImage(file) && !isVideo(file)) return setError("Use an image or video file.");
    if (!replaceId && scenes.length >= MAX_SCENES) return setError("Promo Mode supports up to 10 scenes.");
    setBusy(replaceId ? "Replacing scene…" : "Uploading scene…"); setError(null);
    try {
      const kind: Scene["kind"] = isImage(file) ? "image" : "video";
      const uploaded = kind === "image" ? await uploadImage(file) : await uploadVideo(file);
      if (replaceId) return patch(replaceId, { url: uploaded.url, name: file.name, kind, motion: kind === "image" ? "push-in" : "static" });
      const scene: Scene = {
        id: newId(), name: file.name, url: uploaded.url, kind, duration: 5,
        motion: kind === "image" ? "push-in" : "static", fit: "cover", focalX: 50, focalY: 50, uiSafe: false,
        text: "", textIn: 0.2, textOut: 4.7, textPosition: "bottom", productionNotes: "",
      };
      setScenes((xs) => [...xs, scene]); setSelectedId(scene.id);
    } catch (e) { setError(getErrorMessage(e)); } finally { setBusy(null); }
  }

  async function addAudio(file: File, which: "music" | "voice") {
    setBusy(which === "music" ? "Uploading music…" : "Uploading voiceover…"); setError(null);
    try {
      const up = await uploadAudioAsset(file); const asset = { name: file.name, url: up.url };
      which === "music" ? setMusic(asset) : setVoice(asset);
    } catch (e) { setError(getErrorMessage(e)); } finally { setBusy(null); }
  }

  function move(id: string, d: -1 | 1) {
    setScenes((xs) => { const i = xs.findIndex((s) => s.id === id), j = i + d; if (i < 0 || j < 0 || j >= xs.length) return xs; const n = [...xs]; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  }

  function remove(id: string) { setScenes((xs) => xs.filter((s) => s.id !== id)); if (selectedId === id) setSelectedId(null); }
  function setUiSafe(s: Scene, checked: boolean) { patch(s.id, { uiSafe: checked, fit: checked ? "contain" : s.fit, motion: checked && s.motion.startsWith("pan-") ? "push-in" : s.motion }); }

  async function exportPromo() {
    if (!scenes.length) return setError("Add at least one scene first.");
    setError(null); setRenderUrl(null); setRenderStatus("Submitting…");
    let cursor = 0;
    const overlays: NonNullable<PromoRenderRequest["textOverlays"]> = [];
    const renderScenes = scenes.map((s) => {
      const start = cursor; cursor += s.duration;
      if (s.text.trim()) overlays.push({ text: s.text.trim(), start: start + Math.max(0, Math.min(s.duration, s.textIn)), end: start + Math.max(0, Math.min(s.duration, s.textOut)), position: s.textPosition });
      return { url: s.url, kind: s.kind, duration: s.duration, motion: s.kind === "image" ? s.motion : "static", fit: s.fit, focalX: s.focalX, focalY: s.focalY };
    });
    const req: PromoRenderRequest = {
      projectId: `promo-${Date.now()}`, duration: totalDuration, aspectRatio, scenes: renderScenes, textOverlays: overlays,
      musicUrl: music?.url, voiceoverUrl: voice?.url, musicVolume, voiceoverVolume: voiceVolume, duckMusic,
    };
    try {
      const submitted = await submitPromoRender(req);
      localStorage.setItem(ACTIVE_PROMO_RENDER_KEY, submitted.renderId);
      const out = await waitForPromoRender(submitted.renderId, (job) => {
        if (job.state === "running") setRenderStatus("Rendering promo…");
        else if (job.state === "queued") setRenderStatus("Queued…");
      });
      if (out) {
        setRenderUrl(out.url);
        setRenderStatus("Render complete");
      }
    } catch (e) {
      const message = getErrorMessage(e);
      if (message.includes("render job not found")) {
        localStorage.removeItem(ACTIVE_PROMO_RENDER_KEY);
        setError("Render was interrupted by a server restart. Please export again.");
      } else {
        setError(message);
      }
      setRenderStatus(null);
    }
  }

  return <div className="promo-workspace">
    <header className="promo-header">
      <div><div className="promo-eyebrow">EZAv2 · Promo Mode</div><h1>Social Promo Builder</h1></div>
      <div className="promo-header-actions">
        <span className={`promo-duration ${onTarget ? "on-target" : "off-target"}`}>{totalDuration.toFixed(1)}s · target 30–35s</span>
        <a className="btn ghost" href="/">← Music Video</a>
        <button className="btn primary" disabled={!scenes.length || !!busy || renderInProgress} onClick={() => void exportPromo()}>{renderInProgress ? renderStatus : "Export Promo MP4"}</button>
        {renderUrl && <a className="btn" href={renderUrl} target="_blank" rel="noreferrer">View render</a>}
      </div>
    </header>

    <div className="promo-grid">
      <aside className="promo-scenes-panel">
        <div className="promo-panel-heading"><div><strong>Scenes</strong><span>{scenes.length}/{MAX_SCENES}</span></div><button className="btn" disabled={scenes.length >= MAX_SCENES || !!busy} onClick={() => addRef.current?.click()}>+ Add one</button></div>
        <input ref={addRef} hidden type="file" accept="image/*,video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void addScene(f); e.target.value = ""; }} />
        <div className="promo-scene-list">
          {!scenes.length && <button className="promo-empty-scenes" onClick={() => addRef.current?.click()}><strong>Add your first shot</strong><span>Images or clips · one at a time</span></button>}
          {scenes.map((s, i) => <button key={s.id} className={`promo-scene-card ${selected?.id === s.id ? "selected" : ""}`} onClick={() => setSelectedId(s.id)}>
            <div className="promo-scene-thumb">{s.kind === "image" ? <img src={s.url} alt="" /> : <video src={s.url} muted preload="metadata" />}</div>
            <div className="promo-scene-meta"><strong>Scene {i + 1}</strong><span>{s.name}</span><small>{s.duration.toFixed(1)}s · {s.kind}{s.uiSafe ? " · UI SAFE" : ""}</small></div>
          </button>)}
        </div>
      </aside>

      <main className="promo-center">
        <div className={`promo-stage ratio-${aspectRatio.replace(":", "-")}`}>
          {selected ? <>
            {selected.kind === "image" ? <img key={`${selected.id}-${selected.motion}`} className={`promo-stage-media promo-motion-${selected.motion}`} src={selected.url} alt="Preview" style={{ objectFit: selected.fit, objectPosition: `${selected.focalX}% ${selected.focalY}%` }} /> : <video className="promo-stage-media" src={selected.url} style={{ objectFit: selected.fit, objectPosition: `${selected.focalX}% ${selected.focalY}%` }} muted loop autoPlay playsInline controls />}
            {selected.text.trim() && <div className={`promo-preview-copy pos-${selected.textPosition}`}>{selected.text}</div>}
            {selected.uiSafe && <div className="promo-ui-safe-badge">UI SAFE</div>}
          </> : <div className="promo-stage-empty">Add a scene</div>}
        </div>
        <div className="promo-sequence-bar">{scenes.map((s, i) => <button key={s.id} className={selected?.id === s.id ? "active" : ""} style={{ flexGrow: Math.max(1, s.duration) }} onClick={() => setSelectedId(s.id)}>{i + 1}</button>)}</div>
        <section className="promo-audio-panel">
          <AudioCard title="Background music" asset={music} volume={musicVolume} max={1.25} onVolume={setMusicVolume} onFile={(f) => void addAudio(f, "music")} />
          <AudioCard title="Voiceover" asset={voice} volume={voiceVolume} max={1.5} onVolume={setVoiceVolume} onFile={(f) => void addAudio(f, "voice")} extra={<label className="promo-check"><input type="checkbox" checked={duckMusic} onChange={(e) => setDuckMusic(e.target.checked)} /> Auto-duck music under voice</label>} />
        </section>
        {renderUrl && <section className="promo-render-ready">
          <strong>Render ready</strong>
          <span>Your promo finished successfully.</span>
          <div>
            <a className="btn primary" href={renderUrl} target="_blank" rel="noreferrer">View render</a>
            <a className="btn" href={renderUrl} download>Download MP4</a>
          </div>
        </section>}
      </main>

      <aside className="promo-inspector">
        <div className="promo-panel-heading"><strong>Shot Controls</strong><span>{busy ?? ""}</span></div>
        <label className="promo-field"><span>Format</span><select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as typeof aspectRatio)}><option value="9:16">9:16 · TikTok / Reels / Shorts</option><option value="16:9">16:9 · YouTube / web</option><option value="4:5">4:5 · Instagram feed</option></select></label>
        {selected ? <>
          <div className="promo-shot-actions"><button className="btn" onClick={() => move(selected.id, -1)}>↑ Earlier</button><button className="btn" onClick={() => move(selected.id, 1)}>↓ Later</button><label className="btn promo-file-button">Replace<input hidden type="file" accept="image/*,video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void addScene(f, selected.id); e.target.value = ""; }} /></label><button className="btn danger" onClick={() => remove(selected.id)}>Delete</button></div>
          <label className="promo-field"><span>Duration</span><input type="number" min="0.5" max="30" step="0.1" value={selected.duration} onChange={(e) => { const d = Math.max(.5, Math.min(30, Number(e.target.value) || .5)); patch(selected.id, { duration: d, textOut: Math.min(d, selected.textOut) }); }} /></label>
          {selected.kind === "image" && <label className="promo-field"><span>Motion</span><select value={selected.motion} onChange={(e) => patch(selected.id, { motion: e.target.value as Motion })}><option value="static">Static</option><option value="push-in">Slow push-in</option><option value="zoom-out">Slow zoom-out</option><option value="pan-left">Pan left</option><option value="pan-right">Pan right</option></select></label>}
          <label className="promo-field"><span>Fit</span><select value={selected.fit} onChange={(e) => patch(selected.id, { fit: e.target.value as Fit })}><option value="cover">Fill frame / crop</option><option value="contain">Show full image</option></select></label>
          <label className="promo-check promo-ui-safe"><input type="checkbox" checked={selected.uiSafe} onChange={(e) => setUiSafe(selected, e.target.checked)} /> UI-safe — preserve screens, certificates and exact graphics</label>
          <label className="promo-range"><span>Horizontal focus {selected.focalX}%</span><input disabled={selected.fit === "contain"} type="range" min="0" max="100" value={selected.focalX} onChange={(e) => patch(selected.id, { focalX: Number(e.target.value) })} /></label>
          <label className="promo-range"><span>Vertical focus {selected.focalY}%</span><input disabled={selected.fit === "contain"} type="range" min="0" max="100" value={selected.focalY} onChange={(e) => patch(selected.id, { focalY: Number(e.target.value) })} /></label>
          <div className="promo-divider" />
          <label className="promo-field"><span>On-screen text</span><textarea value={selected.text} placeholder="CAN YOU PROVE IT?" onChange={(e) => patch(selected.id, { text: e.target.value })} /></label>
          <div className="promo-inline-fields"><label className="promo-field"><span>Text in</span><input type="number" min="0" max={selected.duration} step="0.1" value={selected.textIn} onChange={(e) => patch(selected.id, { textIn: Number(e.target.value) || 0 })} /></label><label className="promo-field"><span>Text out</span><input type="number" min="0" max={selected.duration} step="0.1" value={selected.textOut} onChange={(e) => patch(selected.id, { textOut: Number(e.target.value) || 0 })} /></label></div>
          <label className="promo-field"><span>Text position</span><select value={selected.textPosition} onChange={(e) => patch(selected.id, { textPosition: e.target.value as Position })}><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option></select></label>
          <div className="promo-divider" />
          <label className="promo-field"><span>Production notes · NEVER SPOKEN</span><textarea value={selected.productionNotes} placeholder="Camera movement, edit note, visual direction…" onChange={(e) => patch(selected.id, { productionNotes: e.target.value })} /></label>
        </> : <p className="promo-muted">Add a scene to unlock shot controls.</p>}
        <div className="promo-divider" />
        <label className="promo-field"><span>Voiceover script · reference only</span><textarea value={voiceScript} placeholder="Paste narration here. Production notes stay separate." onChange={(e) => setVoiceScript(e.target.value)} /></label>
        <p className="promo-muted">Only uploaded voiceover audio is mixed into the export. Production notes are never sent to speech.</p>
        {error && <div className="promo-error">{error}</div>}{renderStatus && !renderUrl && <div className="promo-status">{renderStatus}</div>}
      </aside>
    </div>
  </div>;
}

function AudioCard({ title, asset, volume, max, onVolume, onFile, extra }: { title: string; asset: AudioAsset | null; volume: number; max: number; onVolume: (n: number) => void; onFile: (f: File) => void; extra?: ReactNode }) {
  return <div className="promo-audio-card"><div className="promo-audio-title"><strong>{title}</strong><span>{asset?.name ?? "none"}</span></div><label className="btn promo-file-button">{asset ? "Replace" : "Add"}<input hidden type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} /></label><label className="promo-range"><span>Volume {Math.round(volume * 100)}%</span><input type="range" min="0" max={max} step="0.01" value={volume} onChange={(e) => onVolume(Number(e.target.value))} /></label>{extra}</div>;
}
