# Original Music Video Studio → Agnes Video V2.0

This project was converted directly from the `music-video-studio.zip` archive uploaded on 2026-08-16. The uploaded working tree—not a later converted project—was used as the baseline.

## Active video generation

Agnes Video V2.0 is the sole active video-generation provider. The editor exposes:

- Text → Video
- Image → Video
- Keyframe → Video

Timeline duration remains authoritative. Agnes requests use 24 fps, valid `8n+1` frame counts, and a maximum of 441 frames per provider request. Longer timeline clips are generated as internal sequential segments, stitched, and hard-trimmed to the exact timeline duration.

## Preserved original workflows

- Audio upload and local librosa analysis
- WaveSurfer/timeline handoff
- Analysis-driven sections and clip timing
- Character/reference image and lookbook workflows
- Clip/image libraries
- Project save/load
- Local or S3-backed storage
- Frame extraction and FFmpeg processing
- Timeline editing and Final Cut render
- Original uploaded song as the final soundtrack

## Audio-analysis reliability

Song analysis now completes inside the upload request and returns the finished analysis to the browser. The active UI no longer starts a detached analysis task and polls indefinitely. A failure returns a real error instead of leaving the upload card stuck on `Analyzing…`. Sparse or ambient audio with no reliable beat grid falls back to a safe full-song section instead of crashing section clustering.

## Render deployment

The workspace `@mvs/shared` package builds to `packages/shared/dist` before the web/API packages compile, matching the original monorepo build boundary and avoiding strict TypeScript resolution failures on Render.

Use the included `render.yaml`. Set `AGNES_API_KEY` in Render. For persistent projects/media across service restarts, configure the existing S3 storage variables or a Render persistent disk rather than relying on ephemeral local storage.
