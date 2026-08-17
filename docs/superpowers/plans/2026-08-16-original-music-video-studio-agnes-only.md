# Original Music Video Studio Agnes-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the exact uploaded original `music-video-studio` working tree to Agnes Video V2.0-only video generation while preserving its editor/timeline/library/WaveSurfer/FFmpeg/project workflow and making local audio analysis reliable on Render without Modal.

**Architecture:** Replace the Runway/FAL generation adapter with a single Agnes provider boundary that persists jobs through the existing storage abstraction. Keep the original timeline/editor components, but expose only Text→Video, Image→Video, Keyframe→Video plus non-generative library reuse. Move reusable librosa analysis out of `modal/`, run it locally during song upload, and return completed analysis in the upload response so the browser immediately loads WaveSurfer.

**Tech Stack:** TypeScript, Fastify, React, Zustand, WaveSurfer, Python/librosa, FFmpeg, existing local/S3 storage, Agnes Video V2.0 HTTP API.

## Global Constraints

- Use the exact uploaded original working tree as supplied; do not reset its pre-existing dirty Git changes.
- Agnes Video V2.0 is the sole active video-generation provider.
- Keep Text→Video, Image→Video, and Keyframe→Video.
- Keep clip library reuse, image uploads/lookbook, project save/load, timeline editing, FFmpeg render, and original song audio.
- Remove active Runway, FAL, Veo, SeedDance, Aleph, LipSync, Wan, Hunyuan, LTX, and Modal runtime dependencies/configuration.
- Agnes frame rate is 24 fps; `num_frames` must be `8n+1` and `<=441`.
- Long logical timeline clips are split into internal sequential Agnes segments and returned as one logical clip.
- Agnes output is normalized silent and hard-trimmed to the timeline duration; final export uses the original uploaded song.
- Image/keyframe inputs sent to Agnes must be public HTTPS URLs.
- Audio analysis must be local Python/librosa only and must not remain indefinitely `pending`.

---

### Task 1: Provider core and job persistence
**Files:** create `apps/api/src/agnes_core.ts`, `apps/api/src/agnes_http.ts`, `apps/api/src/generationJobs.ts`; tests under `tests/`.
- [ ] Write failing tests for frame math, duration splitting, create IDs, completed metadata URL, and wait statuses.
- [ ] Run tests and confirm RED.
- [ ] Implement the pure Agnes core and HTTP adapter.
- [ ] Run tests and confirm GREEN.

### Task 2: Agnes media pipeline and API routes
**Files:** create `apps/api/src/agnesVideo.ts`, `apps/api/src/video_stitch.ts`; modify `apps/api/src/ffmpeg.ts`, `apps/api/src/server.ts`, `apps/api/src/config.ts`, `apps/api/package.json`.
- [ ] Write failing route/source checks for Agnes-only generation endpoints and removal of Runway/FAL routes.
- [ ] Run checks and confirm RED.
- [ ] Add persistent Agnes jobs, provider polling, safe video download, normalization, continuity segmentation, and stitch logic.
- [ ] Replace generation routes/task status mapping with Agnes-only routes.
- [ ] Remove Runway/FAL dependency and source modules.
- [ ] Run checks and confirm GREEN.

### Task 3: Original editor converted to three Agnes modes
**Files:** modify `packages/shared/src/index.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/scheduler.ts`, `apps/web/src/components/Sidebar.tsx`, `apps/web/src/lib/store.ts`, `apps/web/src/components/LeftRail.tsx`, `apps/web/src/components/VideoPreview.tsx`.
- [ ] Write failing source checks showing retired providers/modes are still exposed.
- [ ] Run checks and confirm RED.
- [ ] Expose only Agnes Text→Video, Image→Video, Keyframe→Video; preserve clip library reuse.
- [ ] Keep character/lookbook images as ordinary Agnes reference images; remove avatar/lip-sync generation UI.
- [ ] Add legacy source/model normalization when loading old project snapshots.
- [ ] Remove old provider-specific preview/render assumptions.
- [ ] Run checks and confirm GREEN.

### Task 4: Local audio analysis and WaveSurfer handoff
**Files:** create `audio_analysis/` from reusable original analyzer code; modify `apps/api/src/audio.ts`, `apps/api/src/server.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/components/TimelineDropzone.tsx`, root scripts/env/deploy docs.
- [ ] Write failing check for detached analysis/polling and `MODAL_AUDIO_URL` references.
- [ ] Run checks and confirm RED.
- [ ] Move analyzer to neutral `audio_analysis/`, remove Modal runtime files/config.
- [ ] Make song upload await local analysis and return `analysis` in the upload response.
- [ ] Make TimelineDropzone load that analysis directly into the original WaveSurfer/timeline flow.
- [ ] Run local analyzer regression and source checks.

### Task 5: Render/deployment cleanup and final verification
**Files:** modify render handling/docs/env; create `render.yaml` and validation tests as needed.
- [ ] Ensure generated Agnes clips are silent/exact-duration and renderer uses original song.
- [ ] Remove stale provider-specific env/docs/infrastructure references from active deployment guidance.
- [ ] Add Render build command that installs `audio_analysis/requirements.txt` before Node build.
- [ ] Run all dependency-free tests, Python audio regression, TS/TSX syntax/import sweep, and full build if dependencies can be installed.
- [ ] Package a fresh ZIP and rerun verification against the extracted ZIP.
