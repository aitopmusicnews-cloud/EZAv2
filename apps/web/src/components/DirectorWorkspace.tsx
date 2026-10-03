import { useState, type ChangeEvent, type DragEvent } from "react";
import {
  getErrorMessage,
  type AudioAnalysis,
  type Clip,
  type DirectorPlan,
  type DirectorStage,
  type LyricDocument,
  type SongUnderstanding,
} from "@mvs/shared";
import { uploadSong } from "../lib/api.js";
import {
  alignOfficialLyricsApi,
  requestProfessionalTreatment,
  requestSongUnderstanding,
  transcribeSong,
} from "../lib/directorPhaseAApi.js";
import { useStore } from "../lib/store.js";
import {
  approveAllReadyDirectorClips,
  approveAllStoryboardImages,
  enqueueDirectorVideos,
  generateStoryboardImages,
  renderDirectorFinal,
} from "../lib/directorActions.js";
import "../styles/director.css";
import "../styles/directorPhaseA.css";

const STEPS: Array<{ label: string; stage: DirectorStage }> = [
  { label: "1. Song", stage: "song" },
  { label: "2. Lyrics", stage: "lyrics" },
  { label: "3. Understanding", stage: "understanding" },
  { label: "4. Treatment", stage: "treatment" },
  { label: "5. Plan", stage: "plan" },
  { label: "6. Images", stage: "images" },
  { label: "7. Takes", stage: "takes" },
  { label: "8. Edit", stage: "edit" },
  { label: "9. Final", stage: "final" },
];

export function DirectorWorkspace({ onOpenAdvanced }: { onOpenAdvanced: () => void }) {
  const songId = useStore((s) => s.songId);
  const songFilename = useStore((s) => s.songFilename);
  const audioUrl = useStore((s) => s.audioUrl);
  const analysis = useStore((s) => s.analysis);
  const directorVision = useStore((s) => s.directorVision);
  const directorStage = useStore((s) => s.directorStage);
  const lyricDocument = useStore((s) => s.lyricDocument);
  const songUnderstanding = useStore((s) => s.songUnderstanding);
  const directorPlan = useStore((s) => s.directorPlan);
  const clips = useStore((s) => s.clips);
  const directorFinalUrl = useStore((s) => s.directorFinalUrl);

  const loadSong = useStore((s) => s.loadSong);
  const unloadSong = useStore((s) => s.unloadSong);
  const setDirectorVision = useStore((s) => s.setDirectorVision);
  const setDirectorStage = useStore((s) => s.setDirectorStage);
  const setLyricDocument = useStore((s) => s.setLyricDocument);
  const updateLyricSegment = useStore((s) => s.updateLyricSegment);
  const approveLyrics = useStore((s) => s.approveLyrics);
  const markInstrumental = useStore((s) => s.markInstrumental);
  const setSongUnderstanding = useStore((s) => s.setSongUnderstanding);
  const updateSongUnderstanding = useStore((s) => s.updateSongUnderstanding);
  const approveSongUnderstanding = useStore((s) => s.approveSongUnderstanding);
  const applyProfessionalDirectorPlan = useStore((s) => s.applyProfessionalDirectorPlan);
  const approveDirectorPlan = useStore((s) => s.approveDirectorPlan);

  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [officialLyrics, setOfficialLyrics] = useState("");

  const clearMessages = () => {
    setError(null);
    setStatus(null);
  };

  const runTranscription = async (input: { songId: string; audioUrl: string; duration: number }) => {
    setBusy("transcription");
    setStatus("Transcribing vocals and aligning lyric timing…");
    setError(null);
    try {
      const document = await transcribeSong(input);
      setLyricDocument(document);
      setStatus("Draft lyrics are ready. Verify every important line before approval.");
    } catch (err) {
      setStatus(null);
      setError(`Automatic transcription unavailable: ${getErrorMessage(err)} Your song is still loaded. Retry transcription, paste official lyrics, or mark the track instrumental.`);
    } finally {
      setBusy(null);
    }
  };

  const handleSong = async (file: File) => {
    clearMessages();
    setBusy("upload");
    setStatus("Uploading and analyzing music structure…");
    try {
      const result = await uploadSong(file);
      loadSong(result.id, result.audioUrl, result.analysis, result.filename ?? file.name);
      setDirectorStage("lyrics");
      setBusy(null);
      setStatus("Song analyzed. Transcribe vocals, paste official lyrics, or mark the track instrumental to continue.");
    } catch (err) {
      setBusy(null);
      setStatus(null);
      setError(`Song upload failed: ${getErrorMessage(err)}`);
    }
  };

  const retryTranscription = async () => {
    if (!songId || !audioUrl || !analysis) return;
    await runTranscription({ songId, audioUrl, duration: analysis.duration });
  };

  const alignOfficial = async () => {
    const text = officialLyrics.trim();
    if (!text) {
      setError("Paste official lyrics before aligning them.");
      return;
    }
    if (!lyricDocument?.words?.length) {
      setLyricDocument({ source: "official", rawText: text, segments: [] });
      setError("Official lyrics are saved, but timing is unresolved. Retry automatic transcription, then use Align Official Lyrics to map these words to the song.");
      return;
    }
    setBusy("align");
    clearMessages();
    try {
      const aligned = await alignOfficialLyricsApi({ draft: lyricDocument, officialText: text });
      setLyricDocument(aligned);
      setStatus("Official wording is aligned to the detected song timing. Review it before approval.");
    } catch (err) {
      setError(`Official lyric alignment failed: ${getErrorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const approveCurrentLyrics = () => {
    clearMessages();
    approveLyrics();
    const approved = useStore.getState().lyricDocument?.approvedAt;
    if (!approved) {
      setError("Vocal lyrics need at least one timed, non-empty lyric segment before approval.");
      return;
    }
    // Keep the user on Lyrics so the Analyze button remains an explicit action.
    setDirectorStage("lyrics");
    setStatus("Lyrics approved. BeatSync can now analyze meaning using the verified words plus the music structure.");
  };

  const markTrackInstrumental = () => {
    clearMessages();
    markInstrumental();
    setDirectorStage("lyrics");
    setStatus("Instrumental Mode approved explicitly. Song Understanding will use music structure plus your vision, without inventing lyrics.");
  };

  const analyzeMeaning = async () => {
    const currentLyrics = useStore.getState().lyricDocument;
    if (!analysis || !currentLyrics?.approvedAt) {
      setError("Approve the lyrics or explicitly mark the song instrumental before Song Understanding.");
      return;
    }
    setBusy("understanding");
    clearMessages();
    setStatus("Analyzing song meaning, emotional arc, key moments, motifs, and performance opportunities…");
    try {
      const understanding = await requestSongUnderstanding({
        lyrics: currentLyrics,
        analysis,
        vision: directorVision,
      });
      setSongUnderstanding(understanding);
      setDirectorStage("understanding");
      setStatus("Song Understanding is ready. Edit anything that does not match the artist's intent before approval.");
    } catch (err) {
      setStatus(null);
      setError(`Song Understanding failed: ${getErrorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const reanalyzeMeaning = () => void analyzeMeaning();

  const buildProfessionalTreatment = async () => {
    if (!analysis || !songUnderstanding?.approvedAt) {
      setError("Approve Song Understanding before generating the professional treatment.");
      return;
    }
    setBusy("treatment");
    clearMessages();
    setStatus("Building a production-ready treatment and shot plan with Azure…");
    try {
      const result = await requestProfessionalTreatment({
        analysis,
        understanding: songUnderstanding,
        vision: directorVision,
      });
      applyProfessionalDirectorPlan(result.plan, result.productionBible);
      setStatus("Professional treatment and shot plan are ready. Review the plan before generating images.");
    } catch (err) {
      setStatus(null);
      setError(`Professional Treatment failed: ${getErrorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const approvePlanAndContinue = () => {
    clearMessages();
    approveDirectorPlan();
    const approved = useStore.getState().directorPlan?.approvedAt;
    if (!approved) {
      setError("The plan cannot be approved until its production continuity rules are complete.");
      return;
    }
    setDirectorStage("images");
    setStatus("Plan approved. Generate the storyboard images next.");
  };

  const generateImages = async () => {
    setBusy("images");
    clearMessages();
    try {
      await generateStoryboardImages((completed, total) => {
        setStatus(`Generating storyboard images… ${completed}/${total}`);
      });
      setStatus("Storyboard images are ready. Review them, then approve all to continue.");
    } catch (err) {
      setStatus(null);
      setError(`Storyboard generation failed: ${getErrorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const approveImagesAndContinue = () => {
    clearMessages();
    approveAllStoryboardImages();
    const plan = useStore.getState().directorPlan;
    if (!plan?.shots.every((shot) => shot.imageApproved && shot.imageUrl)) {
      setError("Every storyboard image must be ready before continuing.");
      return;
    }
    setDirectorStage("takes");
    setStatus("Storyboard approved. Generate the Agnes video takes next.");
  };

  const generateVideoTakes = () => {
    clearMessages();
    try {
      const queued = enqueueDirectorVideos();
      setStatus(queued.length
        ? `Queued ${queued.length} Agnes video take${queued.length === 1 ? "" : "s"}. Generation continues while you stay on this screen.`
        : "All video takes are already generated.");
    } catch (err) {
      setError(`Video generation could not start: ${getErrorMessage(err)}`);
    }
  };

  const approveTakesAndContinue = () => {
    clearMessages();
    approveAllReadyDirectorClips();
    const plan = useStore.getState().directorPlan;
    if (!plan?.shots.every((shot) => shot.videoApproved)) {
      setError("All Agnes video takes must finish before continuing to the final edit.");
      return;
    }
    setDirectorStage("edit");
    setStatus("All video takes approved. The project is ready for final render.");
  };

  const renderFinalVideo = async () => {
    setBusy("render");
    clearMessages();
    setStatus("Rendering final music video with the original song…");
    try {
      const url = await renderDirectorFinal((job) => {
        if (job.state === "queued") setStatus("Final render queued…");
        else if (job.state === "running") setStatus("Rendering final music video…");
      });
      setStatus("Final music video is ready.");
      return url;
    } catch (err) {
      setStatus(null);
      setError(`Final render failed: ${getErrorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const videoTakesReady = Boolean(directorPlan?.shots.length) && directorPlan!.shots.every((shot) => {
    const clip = clips.find((item) => item.id === shot.clipId);
    return clip?.status === "ready" && Boolean(clip.videoUrl);
  });

  const canOpenStage = (stage: DirectorStage) => {
    if (stage === "song") return true;
    if (stage === "lyrics") return Boolean(analysis);
    if (stage === "understanding") return Boolean(lyricDocument?.approvedAt);
    if (stage === "treatment") return Boolean(songUnderstanding?.approvedAt);
    if (stage === "plan") return directorPlan?.planningBasis === "professional-treatment";
    if (stage === "images") return Boolean(directorPlan?.approvedAt);
    if (stage === "takes" || stage === "clips") return Boolean(directorPlan?.approvedAt);
    if (stage === "edit") return videoTakesReady;
    if (stage === "final") return Boolean(directorFinalUrl);
    return false;
  };

  const onPickSong = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleSong(file);
    event.target.value = "";
  };

  const onDropSong = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) void handleSong(file);
  };

  const effectiveStage: DirectorStage = directorStage === "clips" ? "takes" : directorStage;

  return (
    <div className="director-app">
      <header className="director-header">
        <div>
          <div className="director-kicker">EZAv2 + BeatSync</div>
          <h1>Professional Music Video Director</h1>
        </div>
        <button type="button" className="btn ghost" onClick={onOpenAdvanced}>Advanced Editor</button>
      </header>

      <nav className="director-stepper director-stepper-scroll" aria-label="Professional music video stages">
        {STEPS.map(({ label, stage }) => {
          const enabled = canOpenStage(stage);
          return (
            <button
              type="button"
              key={stage}
              disabled={!enabled}
              className={effectiveStage === stage ? "active" : ""}
              onClick={() => enabled && setDirectorStage(stage)}
            >
              {label}
            </button>
          );
        })}
      </nav>

      {error && <div className="director-alert"><strong>Needs attention:</strong> {error}<button type="button" onClick={() => setError(null)}>×</button></div>}
      {status && <div className="director-progress">{status}</div>}

      <main className="director-main">
        {effectiveStage === "song" && (
          <SongStep
            songFilename={songFilename}
            analysis={analysis}
            vision={directorVision}
            setVision={setDirectorVision}
            dragOver={dragOver}
            setDragOver={setDragOver}
            busy={busy}
            onDrop={onDropSong}
            onPick={onPickSong}
            onChangeSong={() => { unloadSong(); clearMessages(); setOfficialLyrics(""); }}
            onContinue={() => setDirectorStage("lyrics")}
          />
        )}

        {effectiveStage === "lyrics" && analysis && (
          <LyricsStep
            document={lyricDocument}
            officialLyrics={officialLyrics}
            setOfficialLyrics={setOfficialLyrics}
            busy={busy}
            onRetry={() => void retryTranscription()}
            onUpdateSegment={updateLyricSegment}
            onAlign={() => void alignOfficial()}
            onApprove={approveCurrentLyrics}
            onInstrumental={markTrackInstrumental}
            onAnalyze={() => void analyzeMeaning()}
            onBack={() => setDirectorStage("song")}
          />
        )}

        {effectiveStage === "understanding" && lyricDocument?.approvedAt && (
          <UnderstandingStep
            understanding={songUnderstanding}
            busy={busy}
            onUpdate={updateSongUnderstanding}
            onReanalyze={reanalyzeMeaning}
            onApprove={() => approveSongUnderstanding()}
            onBack={() => setDirectorStage("lyrics")}
            onAnalyze={() => void analyzeMeaning()}
          />
        )}

        {effectiveStage === "treatment" && (
          <TreatmentStep
            plan={directorPlan}
            busy={busy}
            onGenerate={() => void buildProfessionalTreatment()}
            onReviewPlan={() => setDirectorStage("plan")}
            onBack={() => setDirectorStage("understanding")}
          />
        )}

        {effectiveStage === "plan" && directorPlan && (
          <PlanStep
            plan={directorPlan}
            onApprove={approvePlanAndContinue}
            onBack={() => setDirectorStage("treatment")}
          />
        )}

        {effectiveStage === "images" && directorPlan?.approvedAt && (
          <ImagesStep
            plan={directorPlan}
            busy={busy}
            onGenerate={() => void generateImages()}
            onContinue={approveImagesAndContinue}
            onBack={() => setDirectorStage("plan")}
          />
        )}

        {effectiveStage === "takes" && directorPlan?.approvedAt && (
          <TakesStep
            plan={directorPlan}
            clips={clips}
            allReady={videoTakesReady}
            onGenerate={generateVideoTakes}
            onContinue={approveTakesAndContinue}
            onBack={() => setDirectorStage("images")}
          />
        )}

        {effectiveStage === "edit" && directorPlan?.approvedAt && (
          <EditStep
            busy={busy}
            onRender={() => void renderFinalVideo()}
            onBack={() => setDirectorStage("takes")}
          />
        )}

        {effectiveStage === "final" && directorFinalUrl && (
          <FinalStep
            url={directorFinalUrl}
            onBack={() => setDirectorStage("edit")}
          />
        )}
      </main>
    </div>
  );
}

function SongStep({
  songFilename,
  analysis,
  vision,
  setVision,
  dragOver,
  setDragOver,
  busy,
  onDrop,
  onPick,
  onChangeSong,
  onContinue,
}: {
  songFilename: string | null;
  analysis: AudioAnalysis | null;
  vision: string;
  setVision: (value: string) => void;
  dragOver: boolean;
  setDragOver: (value: boolean) => void;
  busy: string | null;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onPick: (event: ChangeEvent<HTMLInputElement>) => void;
  onChangeSong: () => void;
  onContinue: () => void;
}) {
  return (
    <section className="director-panel director-song-step">
      <div className="director-section-heading">
        <span className="director-step-number">1</span>
        <div><h2>Start with the real song</h2><p>BeatSync analyzes music structure first, then verifies lyrics before it is allowed to interpret the song.</p></div>
      </div>

      {!analysis ? (
        <label
          className={`director-song-drop${dragOver ? " over" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <input type="file" accept="audio/*" hidden onChange={onPick} />
          <strong>{busy === "upload" ? "Uploading and analyzing…" : "Upload MP3 / WAV"}</strong>
          <span>Drop a song here or click to choose</span>
        </label>
      ) : (
        <div className="director-song-loaded">
          <div><strong>{songFilename ?? "Loaded song"}</strong><span>{analysis.bpm.toFixed(0)} BPM · {analysis.key} · {formatTime(analysis.duration)}</span></div>
          <button type="button" className="btn ghost" onClick={onChangeSong}>Change Song</button>
        </div>
      )}

      <label className="director-field">
        <span>Artist / Director Vision <em>optional</em></span>
        <textarea
          value={vision}
          onChange={(event) => setVision(event.target.value)}
          placeholder="Example: glamorous but emotionally isolated, mostly performance with a small narrative thread, no cars."
        />
        <small>This helps interpretation, but BeatSync must still ground lyrical claims in approved lyrics.</small>
      </label>

      {analysis && <button type="button" className="director-primary" onClick={onContinue}>Continue to Lyrics</button>}
    </section>
  );
}

function LyricsStep({
  document,
  officialLyrics,
  setOfficialLyrics,
  busy,
  onRetry,
  onUpdateSegment,
  onAlign,
  onApprove,
  onInstrumental,
  onAnalyze,
  onBack,
}: {
  document: LyricDocument | null;
  officialLyrics: string;
  setOfficialLyrics: (value: string) => void;
  busy: string | null;
  onRetry: () => void;
  onUpdateSegment: (id: string, text: string) => void;
  onAlign: () => void;
  onApprove: () => void;
  onInstrumental: () => void;
  onAnalyze: () => void;
  onBack: () => void;
}) {
  const isInstrumental = document?.source === "instrumental";
  const timed = Boolean(document?.segments.length);
  const approved = Boolean(document?.approvedAt);

  return (
    <section className="director-panel">
      <div className="director-section-heading">
        <span className="director-step-number">2</span>
        <div><h2>Verify the lyrics</h2><p>Automatic transcription is a draft. Correct important words before BeatSync is allowed to interpret meaning.</p></div>
      </div>

      <div className="director-action-row">
        <button type="button" className="btn ghost" disabled={busy === "transcription"} onClick={onRetry}>{document ? "Retry Transcription" : "Transcribe Vocals"}</button>
        <button type="button" className="btn ghost" onClick={onInstrumental}>Mark as instrumental</button>
        <button type="button" className="btn ghost" onClick={onBack}>Back to Song</button>
      </div>

      {isInstrumental ? (
        <div className="director-stage-card director-stage-approved">
          <strong>Instrumental Mode</strong>
          <p>No lyric story will be invented. BeatSync will use music structure and your Director Vision only.</p>
        </div>
      ) : timed ? (
        <div className="director-lyrics-grid">
          {document!.segments.map((segment) => (
            <label className="director-lyric-row" key={segment.id}>
              <span>{formatTime(segment.start)}–{formatTime(segment.end)}</span>
              <textarea value={segment.text} onChange={(event) => onUpdateSegment(segment.id, event.target.value)} />
              <small>{segment.source === "official-aligned" ? "official aligned" : segment.source}</small>
            </label>
          ))}
        </div>
      ) : (
        <div className="director-stage-card director-stage-locked">
          <strong>No timed vocal draft yet</strong>
          <p>You can paste official lyrics now, but professional lyric approval still requires timing from transcription. BeatSync will not fabricate timestamps.</p>
        </div>
      )}

      {!isInstrumental && (
        <div className="director-official-lyrics">
          <label className="director-field">
            <span>Paste official lyrics</span>
            <textarea
              value={officialLyrics}
              onChange={(event) => setOfficialLyrics(event.target.value)}
              placeholder="Paste the artist-approved lyrics here. Line breaks are preserved during alignment."
            />
          </label>
          <button type="button" className="btn ghost" disabled={busy === "align"} onClick={onAlign}>Align Official Lyrics</button>
        </div>
      )}

      <div className="director-approval-bar">
        <div>
          <strong>{approved ? "Lyrics approved" : "Approval required"}</strong>
          <span>{approved ? "Any lyric edit will revoke approval and invalidate Song Understanding." : "BeatSync cannot analyze vocal meaning until you approve the words."}</span>
        </div>
        {!isInstrumental && <button type="button" className="btn" onClick={onApprove}>Approve Lyrics</button>}
        <button type="button" className="director-primary" disabled={!approved || busy === "understanding"} onClick={onAnalyze}>Analyze Song Meaning</button>
      </div>
    </section>
  );
}

function UnderstandingStep({
  understanding,
  busy,
  onUpdate,
  onReanalyze,
  onApprove,
  onBack,
  onAnalyze,
}: {
  understanding: SongUnderstanding | null;
  busy: string | null;
  onUpdate: (patch: Partial<SongUnderstanding>) => void;
  onReanalyze: () => void;
  onApprove: () => void;
  onBack: () => void;
  onAnalyze: () => void;
}) {
  if (!understanding) {
    return (
      <section className="director-panel">
        <div className="director-section-heading">
          <span className="director-step-number">3</span>
          <div><h2>Song Understanding</h2><p>Lyrics are approved. BeatSync is ready to analyze meaning without guessing from BPM alone.</p></div>
        </div>
        <button type="button" className="director-primary" disabled={busy === "understanding"} onClick={onAnalyze}>Analyze Song Meaning</button>
        <button type="button" className="btn ghost" onClick={onBack}>Back to Lyrics</button>
      </section>
    );
  }

  const updateList = (key: keyof SongUnderstanding, value: string) => {
    onUpdate({ [key]: value.split("\n").map((item) => item.trim()).filter(Boolean) } as Partial<SongUnderstanding>);
  };

  const updateMoment = (index: number, patch: Partial<SongUnderstanding["keyLyricMoments"][number]>) => {
    onUpdate({ keyLyricMoments: understanding.keyLyricMoments.map((moment, i) => i === index ? { ...moment, ...patch } : moment) });
  };

  const updateSection = (index: number, patch: Partial<SongUnderstanding["sections"][number]>) => {
    onUpdate({ sections: understanding.sections.map((section, i) => i === index ? { ...section, ...patch } : section) });
  };

  return (
    <section className="director-panel">
      <div className="director-section-heading">
        <span className="director-step-number">3</span>
        <div><h2>Review Song Understanding</h2><p>This becomes the semantic foundation for the professional treatment. Fix anything that does not match the artist's intent.</p></div>
      </div>

      <div className="director-understanding-grid">
        <label className="director-field">
          <span>Theme</span>
          <textarea value={understanding.primaryTheme} onChange={(event) => onUpdate({ primaryTheme: event.target.value })} />
        </label>

        <label className="director-field">
          <span>Emotional Arc</span>
          <textarea value={understanding.emotionalArc.join("\n")} onChange={(event) => updateList("emotionalArc", event.target.value)} />
        </label>

        <div className="director-understanding-block">
          <h3>Key Lyrics</h3>
          {understanding.keyLyricMoments.length ? understanding.keyLyricMoments.map((moment, index) => (
            <div className="director-key-moment" key={`${moment.start}-${index}`}>
              <strong>{formatTime(moment.start)} — “{moment.lyric}”</strong>
              <label><span>Meaning</span><textarea value={moment.meaning} onChange={(event) => updateMoment(index, { meaning: event.target.value })} /></label>
              <label><span>Visual opportunity</span><textarea value={moment.visualOpportunity} onChange={(event) => updateMoment(index, { visualOpportunity: event.target.value })} /></label>
              <span className="director-confidence">Confidence: {moment.confidence}</span>
            </div>
          )) : <p>No lyric-specific moments were claimed for this track.</p>}
        </div>

        <div className="director-understanding-block">
          <h3>Section Map</h3>
          {understanding.sections.map((section, index) => (
            <div className="director-section-map-row" key={`${section.start}-${index}`}>
              <strong>{formatTime(section.start)}–{formatTime(section.end)} · {section.sourceLabel}</strong>
              <input value={section.inferredRole} onChange={(event) => updateSection(index, { inferredRole: event.target.value })} />
              <textarea value={section.lyricalPurpose} onChange={(event) => updateSection(index, { lyricalPurpose: event.target.value })} />
              <textarea value={section.musicalPurpose} onChange={(event) => updateSection(index, { musicalPurpose: event.target.value })} />
              <span className="director-confidence">Confidence: {section.confidence}</span>
            </div>
          ))}
        </div>

        <div className="director-understanding-block">
          <h3>Narrative</h3>
          <label><span>Perspective</span><textarea value={understanding.narrativePerspective} onChange={(event) => onUpdate({ narrativePerspective: event.target.value })} /></label>
          <label><span>Characters / subjects</span><textarea value={understanding.characters.join("\n")} onChange={(event) => updateList("characters", event.target.value)} /></label>
          <label><span>Secondary themes</span><textarea value={understanding.secondaryThemes.join("\n")} onChange={(event) => updateList("secondaryThemes", event.target.value)} /></label>
        </div>

        <label className="director-field">
          <span>Visual Motifs</span>
          <textarea value={understanding.visualMotifs.join("\n")} onChange={(event) => updateList("visualMotifs", event.target.value)} />
        </label>

        <label className="director-field">
          <span>Performance Moments</span>
          <textarea value={understanding.performanceOpportunities.join("\n")} onChange={(event) => updateList("performanceOpportunities", event.target.value)} />
        </label>

        <label className="director-field director-uncertainties">
          <span>Uncertainties</span>
          <textarea value={understanding.uncertaintyNotes.join("\n")} onChange={(event) => updateList("uncertaintyNotes", event.target.value)} />
          <small>Uncertainty is useful. BeatSync should expose ambiguity instead of pretending confidence.</small>
        </label>
      </div>

      <div className="director-approval-bar">
        <button type="button" className="btn ghost" onClick={onBack}>Back to Lyrics</button>
        <button type="button" className="btn ghost" disabled={busy === "understanding"} onClick={onReanalyze}>Re-analyze</button>
        <button type="button" className="director-primary" onClick={onApprove}>Approve Song Understanding</button>
      </div>
    </section>
  );
}

function TreatmentStep({
  plan,
  busy,
  onGenerate,
  onReviewPlan,
  onBack,
}: {
  plan: DirectorPlan | null;
  busy: string | null;
  onGenerate: () => void;
  onReviewPlan: () => void;
  onBack: () => void;
}) {
  return (
    <section className="director-panel">
      <div className="director-section-heading">
        <span className="director-step-number">4</span>
        <div><h2>Professional Treatment</h2><p>Azure turns the approved song understanding into a production-ready visual concept and timed shot plan.</p></div>
      </div>
      {plan?.planningBasis === "professional-treatment" ? (
        <div className="director-stage-card director-stage-approved">
          <strong>{plan.treatment.title}</strong>
          <p>{plan.treatment.concept}</p>
          <p><strong>Style:</strong> {plan.treatment.style}</p>
          <p><strong>Pacing:</strong> {plan.treatment.pacing}</p>
        </div>
      ) : (
        <div className="director-stage-card">
          <strong>Ready to build the treatment</strong>
          <p>This uses the approved Song Understanding, your Director Vision, and fixed music timing. It does not use the retired BPM-only planner.</p>
        </div>
      )}
      <div className="director-action-row">
        <button type="button" className="btn ghost" onClick={onBack}>Back to Understanding</button>
        {plan?.planningBasis === "professional-treatment"
          ? <button type="button" className="director-primary" onClick={onReviewPlan}>Review Shot Plan</button>
          : <button type="button" className="director-primary" disabled={busy === "treatment"} onClick={onGenerate}>{busy === "treatment" ? "Building Treatment…" : "Build Professional Treatment"}</button>}
      </div>
    </section>
  );
}

function PlanStep({
  plan,
  onApprove,
  onBack,
}: {
  plan: DirectorPlan;
  onApprove: () => void;
  onBack: () => void;
}) {
  return (
    <section className="director-panel">
      <div className="director-section-heading">
        <span className="director-step-number">5</span>
        <div><h2>Shot Plan</h2><p>{plan.shots.length} timed shots will become storyboard images and Agnes video takes.</p></div>
      </div>
      <div className="director-understanding-block">
        {plan.shots.map((shot, index) => (
          <div className="director-section-map-row" key={shot.id}>
            <strong>{index + 1}. {formatTime(shot.start)}–{formatTime(shot.end)} · {shot.role}{shot.hero ? " · HERO" : ""}</strong>
            <p>{shot.idea}</p>
            <span>{shot.camera} · {shot.framing} · {shot.mood}</span>
          </div>
        ))}
      </div>
      <div className="director-approval-bar">
        <button type="button" className="btn ghost" onClick={onBack}>Back to Treatment</button>
        <button type="button" className="director-primary" onClick={onApprove}>{plan.approvedAt ? "Plan Approved" : "Approve Plan & Generate Images"}</button>
      </div>
    </section>
  );
}

function ImagesStep({
  plan,
  busy,
  onGenerate,
  onContinue,
  onBack,
}: {
  plan: DirectorPlan;
  busy: string | null;
  onGenerate: () => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const ready = plan.shots.filter((shot) => shot.imageStatus === "ready" && shot.imageUrl).length;
  const allReady = ready === plan.shots.length;
  return (
    <section className="director-panel">
      <div className="director-section-heading">
        <span className="director-step-number">6</span>
        <div><h2>Storyboard Images</h2><p>{ready}/{plan.shots.length} storyboard frames ready.</p></div>
      </div>
      <div className="director-understanding-grid">
        {plan.shots.map((shot) => (
          <div className="director-stage-card" key={shot.id}>
            <strong>{shot.role} · {formatTime(shot.start)}–{formatTime(shot.end)}</strong>
            {shot.imageUrl ? <img src={shot.imageUrl} alt={shot.role} style={{ width: "100%", borderRadius: 8 }} /> : <p>{shot.imageStatus === "failed" ? shot.imageError ?? "Image generation failed." : "Waiting for storyboard image."}</p>}
          </div>
        ))}
      </div>
      <div className="director-approval-bar">
        <button type="button" className="btn ghost" onClick={onBack}>Back to Plan</button>
        <button type="button" className="btn" disabled={busy === "images"} onClick={onGenerate}>{busy === "images" ? "Generating Images…" : ready ? "Generate Missing Images" : "Generate Storyboard Images"}</button>
        <button type="button" className="director-primary" disabled={!allReady || busy === "images"} onClick={onContinue}>Approve Images & Generate Video</button>
      </div>
    </section>
  );
}

function TakesStep({
  plan,
  clips,
  allReady,
  onGenerate,
  onContinue,
  onBack,
}: {
  plan: DirectorPlan;
  clips: Clip[];
  allReady: boolean;
  onGenerate: () => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const readyCount = plan.shots.filter((shot) => clips.find((clip) => clip.id === shot.clipId)?.status === "ready").length;
  const active = plan.shots.some((shot) => {
    const status = clips.find((clip) => clip.id === shot.clipId)?.status;
    return status === "queued" || status === "generating";
  });
  return (
    <section className="director-panel">
      <div className="director-section-heading">
        <span className="director-step-number">7</span>
        <div><h2>Agnes Video Takes</h2><p>{readyCount}/{plan.shots.length} generated video takes ready.</p></div>
      </div>
      <div className="director-understanding-block">
        {plan.shots.map((shot) => {
          const clip = clips.find((item) => item.id === shot.clipId);
          return (
            <div className="director-section-map-row" key={shot.id}>
              <strong>{shot.role} · {formatTime(shot.start)}–{formatTime(shot.end)}</strong>
              <span>Status: {clip?.status ?? "empty"}</span>
              {clip?.lastError && <p>{clip.lastError}</p>}
              {clip?.videoUrl && <video src={clip.videoUrl} controls muted playsInline style={{ width: "100%", maxWidth: 520 }} />}
            </div>
          );
        })}
      </div>
      <div className="director-approval-bar">
        <button type="button" className="btn ghost" onClick={onBack}>Back to Images</button>
        <button type="button" className="btn" disabled={active} onClick={onGenerate}>{active ? "Agnes Generating…" : readyCount ? "Generate Missing Takes" : "Generate Agnes Video Takes"}</button>
        <button type="button" className="director-primary" disabled={!allReady} onClick={onContinue}>Approve Takes & Final Edit</button>
      </div>
    </section>
  );
}

function EditStep({
  busy,
  onRender,
  onBack,
}: {
  busy: string | null;
  onRender: () => void;
  onBack: () => void;
}) {
  return (
    <section className="director-panel">
      <div className="director-section-heading">
        <span className="director-step-number">8</span>
        <div><h2>Final Edit</h2><p>Combine the approved video takes with the original uploaded song as the final soundtrack.</p></div>
      </div>
      <div className="director-stage-card director-stage-approved">
        <strong>Ready to render</strong>
        <p>Generated clip audio is discarded. The original song remains the final music track.</p>
      </div>
      <div className="director-approval-bar">
        <button type="button" className="btn ghost" onClick={onBack}>Back to Takes</button>
        <button type="button" className="director-primary" disabled={busy === "render"} onClick={onRender}>{busy === "render" ? "Rendering…" : "Render Final Music Video"}</button>
      </div>
    </section>
  );
}

function FinalStep({ url, onBack }: { url: string; onBack: () => void }) {
  return (
    <section className="director-panel">
      <div className="director-section-heading">
        <span className="director-step-number">9</span>
        <div><h2>Final Video</h2><p>Your rendered music video is ready.</p></div>
      </div>
      <video src={url} controls playsInline style={{ width: "100%", maxWidth: 960 }} />
      <div className="director-action-row">
        <button type="button" className="btn ghost" onClick={onBack}>Back to Edit</button>
        <a className="director-primary" href={url} target="_blank" rel="noreferrer">Open Final Video</a>
      </div>
    </section>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
