import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AudioAnalysis, AudioSection, Clip, ProductionBible, ReferenceAsset } from "@mvs/shared";
import { AGNES_VIDEO_MODEL, ProjectSnapshot } from "@mvs/shared";
import type { Job } from "./scheduler.js";
import { getWs } from "./wavesurfer-ref.js";

export const MAX_CLIP_LEN = 300;
export const MIN_CLIP_LEN = 0.5;

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 32;
export const ZOOM_STEP = 1.5;

const PERSIST_KEY = "mvs-project-v1";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function nearestBeat(t: number, beats: number[]): number | null {
  if (!beats.length) return null;
  let best = beats[0]!;
  let bestDist = Math.abs(t - best);
  for (const b of beats) {
    const d = Math.abs(t - best);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}

function nearestBeatInRange(t: number, beats: number[], lo: number, hi: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const b of beats) {
    if (b <= lo || b >= hi) continue;
    const d = Math.abs(t - b);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}

function newClipId(): string {
  return `clip-${crypto.randomUUID().slice(0, 8)}`;
}

function subdivideSection(section: AudioSection, beats: number[]): Clip[] {
  const len = section.end - section.start;
  if (len <= MAX_CLIP_LEN) {
    return [
      {
        id: newClipId(),
        start: section.start,
        end: section.end,
        source: "textToVideo",
        status: "empty",
      },
    ];
  }
  const count = Math.ceil(len / MAX_CLIP_LEN);
  const idealLen = len / count;
  const clips: Clip[] = [];
  let cursor = section.start;
  for (let i = 0; i < count - 1; i++) {
    const target = section.start + idealLen * (i + 1);
    const lo = cursor + MIN_CLIP_LEN;
    const hi = section.end - MIN_CLIP_LEN;
    const candidates = beats.filter((b) => b >= lo && b <= hi);
    const cut = candidates.length ? nearestBeat(target, candidates)! : Math.min(hi, Math.max(lo, target));
    clips.push({
      id: newClipId(),
      start: cursor,
      end: cut,
      source: "textToVideo",
      status: "empty",
    });
    cursor = cut;
  }
  clips.push({
    id: newClipId(),
    start: cursor,
    end: section.end,
    source: "textToVideo",
    status: "empty",
  });
  return clips;
}

type State = {
  projectId: string | null;
  projectName: string | null;
  songId: string | null;
  songFilename: string | null;
  audioUrl: string | null;
  analysis: AudioAnalysis | null;
  clips: Clip[];
  selectedClipId: string | null;
  playhead: number;
  isPlaying: boolean;
  characterImageUrl: string | null;
  lookbook: string[];
  productionBible: ProductionBible | null;
  referenceAssets: ReferenceAsset[];
  zoom: number;
  jobs: Job[];

  setProjectName: (name: string) => void;
  loadSong: (songId: string, audioUrl: string, analysis: AudioAnalysis, filename: string | null) => void;
  /** Clear the loaded song + clips/playhead/jobs but keep references and production controls. */
  unloadSong: () => void;
  resetProject: () => void;
  /** Returns a plain object snapshot of the persistable state for saving. */
  getSnapshot: () => Record<string, unknown>;
  /** Restores a previously saved snapshot. */
  restoreSnapshot: (snapshot: Record<string, unknown>) => void;
  selectClip: (id: string | null) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (p: boolean) => void;
  togglePlay: () => void;
  updateClip: (id: string, patch: Partial<Clip>) => void;
  setCharacter: (url: string | null) => void;
  addLookbook: (url: string) => void;
  removeLookbook: (url: string) => void;
  /** Swap a lookbook entry in place after the image library rehosts an upload. */
  replaceLookbookUrl: (oldUrl: string, newUrl: string) => void;
  setProductionBible: (bible: ProductionBible | null) => void;
  upsertReferenceAsset: (asset: ReferenceAsset) => void;
  removeReferenceAsset: (id: string) => void;

  setZoom: (z: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;

  setJobs: (jobs: Job[] | ((prev: Job[]) => Job[])) => void;

  splitAtPlayhead: () => { ok: true; at: number } | { ok: false; reason: string };
  mergeWithRight: (clipId: string) => { ok: true } | { ok: false; reason: string };
  splitPreviewTime: () => number | null;
  /** Move the boundary between clip[idx-1] and clip[idx] to `newTime`.
   *  Generated Agnes clips are invalidated when their logical duration changes. */
  moveBoundary: (rightClipId: string, newTime: number) => void;
};

const emptyState = {
  projectId: null,
  projectName: null,
  songId: null,
  songFilename: null,
  audioUrl: null,
  analysis: null,
  clips: [],
  selectedClipId: null,
  playhead: 0,
  isPlaying: false,
  characterImageUrl: null,
  lookbook: [],
  productionBible: null,
  referenceAssets: [],
  zoom: 1,
  jobs: [],
};

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...emptyState,

      setProjectName: (name) => set({ projectName: name }),

      getSnapshot: () => {
        const s = get();
        return {
          projectId: s.projectId,
          projectName: s.projectName,
          songId: s.songId,
          songFilename: s.songFilename,
          audioUrl: s.audioUrl,
          analysis: s.analysis,
          clips: s.clips,
          characterImageUrl: s.characterImageUrl,
          lookbook: s.lookbook,
          productionBible: s.productionBible,
          referenceAssets: s.referenceAssets,
          zoom: s.zoom,
          playhead: s.playhead,
        };
      },

      restoreSnapshot: (snapshot) => {
        const result = ProjectSnapshot.safeParse(snapshot);
        if (!result.success) {
          console.warn("ignoring invalid project snapshot:", result.error.message);
          return;
        }
        const s = result.data;
        const clips: Clip[] = (s.clips ?? []).map((saved) => {
          const raw = saved as typeof saved & { source?: string; model?: string; archetypeUrl?: string; keyframeEndUrl?: string };
          const source: Clip["source"] =
            raw.source === "library" ? "library"
              : raw.source === "keyframeToVideo" || !!raw.keyframeEndUrl ? "keyframeToVideo"
                : raw.source === "imageToVideo" || raw.source === "archetype" || !!raw.archetypeUrl ? "imageToVideo"
                  : "textToVideo";
          const stale = raw.status === "queued" || raw.status === "generating";
          return {
            ...raw,
            source,
            model: source === "library" ? raw.model : AGNES_VIDEO_MODEL,
            status: stale ? "empty" : raw.status,
            generationTaskId: stale ? undefined : raw.generationTaskId,
            videoUrl: stale ? undefined : raw.videoUrl,
            thumbnailUrl: stale ? undefined : raw.thumbnailUrl,
          } as Clip;
        });
        set({
          ...emptyState,
          projectId: s.projectId ?? null,
          projectName: s.projectName ?? null,
          songId: s.songId ?? null,
          songFilename: s.songFilename ?? null,
          audioUrl: s.audioUrl ?? null,
          analysis: s.analysis ?? null,
          clips,
          characterImageUrl: s.characterImageUrl ?? null,
          lookbook: s.lookbook ?? [],
          productionBible: s.productionBible ?? null,
          referenceAssets: s.referenceAssets ?? [],
          zoom: s.zoom ?? 1,
          playhead: s.playhead ?? 0,
          selectedClipId: null,
          isPlaying: false,
          jobs: [],
        });
      },

      loadSong: (songId, audioUrl, analysis, filename) => {
        const clips = analysis.sections.flatMap((s) => subdivideSection(s, analysis.beats));
        set({
          projectId: get().projectId ?? `proj-${crypto.randomUUID().slice(0, 8)}`,
          songId,
          songFilename: filename,
          audioUrl,
          analysis,
          clips,
          selectedClipId: null,
          playhead: 0,
          isPlaying: false,
          zoom: 1,
          jobs: [],
        });
      },
      unloadSong: () =>
        set({
          songId: null,
          songFilename: null,
          audioUrl: null,
          analysis: null,
          clips: [],
          selectedClipId: null,
          playhead: 0,
          isPlaying: false,
          jobs: [],
        }),
      resetProject: () => set({ ...emptyState }),
      selectClip: (id) => set({ selectedClipId: id }),
      setPlayhead: (t) => set({ playhead: t }),
      setPlaying: (p) => set({ isPlaying: p }),
      togglePlay: () => {
        const ws = getWs();
        if (!ws) return;
        ws.playPause();
      },
      updateClip: (id, patch) =>
        set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      setCharacter: (url) => set({ characterImageUrl: url }),
      addLookbook: (url) =>
        set((s) => (s.lookbook.includes(url) ? s : { lookbook: [...s.lookbook, url] })),
      removeLookbook: (url) =>
        set((s) => ({ lookbook: s.lookbook.filter((u) => u !== url) })),
      replaceLookbookUrl: (oldUrl, newUrl) =>
        set((s) => {
          const idx = s.lookbook.indexOf(oldUrl);
          if (idx < 0 || oldUrl === newUrl) return s;
          if (s.lookbook.includes(newUrl)) {
            return { lookbook: s.lookbook.filter((u) => u !== oldUrl) };
          }
          const next = [...s.lookbook];
          next[idx] = newUrl;
          return { lookbook: next };
        }),
      setProductionBible: (productionBible) => set({ productionBible }),
      upsertReferenceAsset: (asset) =>
        set((s) => {
          const exists = s.referenceAssets.some((item) => item.id === asset.id);
          return {
            referenceAssets: exists
              ? s.referenceAssets.map((item) => item.id === asset.id ? asset : item)
              : [...s.referenceAssets, asset],
          };
        }),
      removeReferenceAsset: (id) =>
        set((s) => ({
          referenceAssets: s.referenceAssets.filter((asset) => asset.id !== id),
          productionBible: s.productionBible
            ? {
                ...s.productionBible,
                characterReferenceAssetIds: s.productionBible.characterReferenceAssetIds?.filter((assetId) => assetId !== id),
                vehicleReferenceAssetIds: s.productionBible.vehicleReferenceAssetIds?.filter((assetId) => assetId !== id),
              }
            : null,
          clips: s.clips.map((clip) => ({
            ...clip,
            referenceAssetIds: clip.referenceAssetIds?.filter((assetId) => assetId !== id),
          })),
        })),

      setZoom: (z) => set({ zoom: clamp(z, ZOOM_MIN, ZOOM_MAX) }),
      zoomIn: () => set((s) => ({ zoom: clamp(s.zoom * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX) })),
      zoomOut: () => set((s) => ({ zoom: clamp(s.zoom / ZOOM_STEP, ZOOM_MIN, ZOOM_MAX) })),
      zoomFit: () => set({ zoom: 1 }),

      setJobs: (jobs) =>
        set((s) => ({ jobs: typeof jobs === "function" ? jobs(s.jobs) : jobs })),

      splitPreviewTime: () => {
        const { clips, playhead, analysis } = get();
        if (!analysis) return null;
        const target = clips.find((c) => playhead > c.start && playhead < c.end);
        if (!target) return null;
        const lo = target.start + MIN_CLIP_LEN;
        const hi = target.end - MIN_CLIP_LEN;
        if (lo >= hi) return null;
        const snap = nearestBeatInRange(playhead, analysis.beats, lo, hi);
        const at = snap ?? clamp(playhead, lo, hi);
        if (at <= target.start || at >= target.end) return null;
        return at;
      },

      splitAtPlayhead: () => {
        const { clips, playhead, analysis } = get();
        if (!analysis) return { ok: false, reason: "no song loaded" };
        const idx = clips.findIndex((c) => playhead > c.start && playhead < c.end);
        if (idx < 0) return { ok: false, reason: "playhead not over a clip" };
        const target = clips[idx]!;

        const lo = target.start + MIN_CLIP_LEN;
        const hi = target.end - MIN_CLIP_LEN;
        if (lo >= hi) return { ok: false, reason: `clip too short to split (min ${MIN_CLIP_LEN * 2}s)` };
        const snap = nearestBeatInRange(playhead, analysis.beats, lo, hi);
        const at = snap ?? clamp(playhead, lo, hi);

        if (at <= target.start || at >= target.end) {
          return { ok: false, reason: "snap target outside clip" };
        }
        if (at - target.start < MIN_CLIP_LEN || target.end - at < MIN_CLIP_LEN) {
          return { ok: false, reason: `each half must be ≥${MIN_CLIP_LEN}s` };
        }

        const left: Clip = { ...target, end: at };
        const wasReady = target.status === "ready";
        const right: Clip = {
          ...target,
          id: newClipId(),
          start: at,
          status: wasReady ? "empty" : target.status,
          videoUrl: wasReady ? undefined : target.videoUrl,
          thumbnailUrl: wasReady ? undefined : target.thumbnailUrl,
          generationTaskId: wasReady ? undefined : target.generationTaskId,
          prompt: wasReady ? undefined : target.prompt,
          lastError: undefined,
        };

        const next = [...clips.slice(0, idx), left, right, ...clips.slice(idx + 1)];
        set({ clips: next, selectedClipId: left.id });
        return { ok: true, at };
      },

      moveBoundary: (rightClipId, newTime) => {
        set((s) => {
          const idx = s.clips.findIndex((c) => c.id === rightClipId);
          if (idx <= 0) return s;
          const left = s.clips[idx - 1]!;
          const right = s.clips[idx]!;

          const minTime = left.start + MIN_CLIP_LEN;
          const maxTime = right.end - MIN_CLIP_LEN;
          const lo = Math.max(minTime, right.end - MAX_CLIP_LEN);
          const hi = Math.min(maxTime, left.start + MAX_CLIP_LEN);
          if (lo >= hi) return s;
          const t = clamp(newTime, lo, hi);

          const resize = (c: Clip, patch: Pick<Clip, "start"> | Pick<Clip, "end">): Clip => {
            const updated = { ...c, ...patch };
            if (c.status !== "ready" || c.source === "library" || c.source === "upload") return updated;
            return {
              ...updated,
              status: "empty",
              videoUrl: undefined,
              thumbnailUrl: undefined,
              generationTaskId: undefined,
              lastError: undefined,
            };
          };

          const newLeft = resize(left, { end: t });
          const newRight = resize(right, { start: t });
          return {
            clips: [...s.clips.slice(0, idx - 1), newLeft, newRight, ...s.clips.slice(idx + 1)],
          };
        });
      },

      mergeWithRight: (clipId) => {
        const { clips } = get();
        const idx = clips.findIndex((c) => c.id === clipId);
        if (idx < 0) return { ok: false, reason: "clip not found" };
        if (idx >= clips.length - 1) return { ok: false, reason: "no neighbor to the right" };
        const left = clips[idx]!;
        const right = clips[idx + 1]!;
        if (right.end - left.start > MAX_CLIP_LEN) {
          return { ok: false, reason: `merged clip would exceed ${MAX_CLIP_LEN}s editor safety limit` };
        }
        const merged: Clip = {
          ...left,
          end: right.end,
          status: left.status === "ready" || right.status === "ready" ? "empty" : left.status,
          videoUrl: undefined,
          thumbnailUrl: undefined,
          generationTaskId: undefined,
          lastError: undefined,
        };
        const next = [...clips.slice(0, idx), merged, ...clips.slice(idx + 2)];
        set({ clips: next, selectedClipId: merged.id });
        return { ok: true };
      },
    }),
    {
      name: PERSIST_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) =>
        ({
          projectId: s.projectId,
          projectName: s.projectName,
          songId: s.songId,
          songFilename: s.songFilename,
          audioUrl: s.audioUrl,
          analysis: s.analysis,
          clips: s.clips,
          characterImageUrl: s.characterImageUrl,
          lookbook: s.lookbook,
          productionBible: s.productionBible,
          referenceAssets: s.referenceAssets,
          zoom: s.zoom,
          playhead: s.playhead,
        }) as Partial<State>,
      merge: (persisted, current) => {
        const result = ProjectSnapshot.safeParse(persisted);
        if (!result.success) {
          if (persisted) {
            console.warn("dropping unrecognized persisted state:", result.error.message);
          }
          return current;
        }
        const ps = result.data;
        const clips: Clip[] = (ps.clips ?? []).map((saved) => {
          const raw = saved as typeof saved & { source?: string; model?: string; archetypeUrl?: string; keyframeEndUrl?: string };
          const source: Clip["source"] =
            raw.source === "library" ? "library"
              : raw.source === "keyframeToVideo" || !!raw.keyframeEndUrl ? "keyframeToVideo"
                : raw.source === "imageToVideo" || raw.source === "archetype" || !!raw.archetypeUrl ? "imageToVideo"
                  : "textToVideo";
          const stale = raw.status === "queued";
          return {
            ...raw,
            source,
            model: source === "library" ? raw.model : AGNES_VIDEO_MODEL,
            status: stale ? "empty" : raw.status,
            generationTaskId: stale ? undefined : raw.generationTaskId,
            videoUrl: stale ? undefined : raw.videoUrl,
            thumbnailUrl: stale ? undefined : raw.thumbnailUrl,
          } as Clip;
        });
        const { avatarId: _legacyAvatarId, avatarName: _legacyAvatarName, ...persistedProject } = ps;
        return { ...current, ...persistedProject, clips };
      },
    }
  )
);
