# Music Video Studio — Agnes Video V2.0

This is the original Music Video Studio codebase, converted so **Agnes Video V2.0 is the only active AI video generator**.

## Workflow

1. Upload an MP3, WAV, M4A, AAC, FLAC, OGG, or Opus file.
2. The local Python/librosa analyzer returns BPM, beat/downbeat timing, onsets, RMS energy, and song sections.
3. WaveSurfer loads the original song and the editor builds an analysis-driven timeline.
4. Choose one visual mode for each timeline clip:
   - **Text → Image** (create a reusable still before animation)
   - **Text → Video**
   - **Image → Video**
   - **Keyframe → Video** (start + end reference images)
   - **Clip library** (reuse existing footage; no generation)
5. Agnes generations are normalized to silent H.264/YUV420P visuals and hard-trimmed to the timeline duration.
6. Long logical timeline clips are split into internal Agnes-sized segments, stitched, and presented to the editor as one clip.
7. Final Cut uses FFmpeg to assemble the timeline and mux the **original uploaded song** as AAC audio.

## Agnes rules

- Video model: `agnes-video-v2.0`
- Image model: `agnes-image-2.1-flash`
- Output timing: 24 fps
- Frame requests: valid `8n+1` counts
- Maximum provider request: 441 frames
- Long timeline slots are segmented internally and stitched automatically.
- Generated clip audio is not used in Final Cut.

## Production controls

EZAv2 can turn production instructions into structured Agnes requests instead of relying on one free-form prompt.

- **Production Bible** — save project-wide character identity, vehicle identity, visual style, global negative guidance, and a default spatial lock.
- **Locked character / vehicle references** — assign semantic reference roles so Agnes image generation can receive the actual recurring character and vehicle images rather than only textual reminders.
- **Reference-aware image generation** — Text → Image automatically uses prompt-only, single-reference img2img, or multi-reference compose behavior based on the locked references selected for the project/scene.
- **Spatial lock presets** — encode real-world geometry such as U.S. left-hand-drive seating, passenger-side camera placement, competitors behind the hero car, rearview-mirror content, and traffic direction.
- **Spatial validation** — obvious contradictions are blocked before spending a generation, for example a left-hand-drive car with the driver assigned to the front-right seat.
- **Negative prompts** — project and scene negatives are combined and de-duplicated. Video negatives are sent to Agnes as `negative_prompt`; image negatives are embedded in an explicit `[AVOID]` section of the compiled image prompt.
- **Request inspector** — **What Agnes will receive** shows the mode, references, compiled prompt, compiled negative prompt, and output settings before generation.
- **Reproducibility** — the editable scene prompt stays separate from the compiled provider prompt, and the compiled request data is persisted with the project.

Detailed compiled image prompts may be up to 12,000 characters at the EZAv2 request boundary. Reference images are still preferred for identity and vehicle appearance so prompt text can focus on spatial logic, action, camera, lighting, and style.

## Audio analysis

Audio analysis is local and cloud-provider independent. The Node API invokes:

```text
audio_analysis/analyze_cli.py
```

The upload request owns the analysis operation. The browser does not launch a detached analysis job or poll forever: a successful upload response includes the completed analysis, then the editor immediately loads WaveSurfer.

Install Python dependencies with:

```bash
python3 -m pip install -r audio_analysis/requirements.txt
```

## Local development

Requirements:

- Node.js 22+
- pnpm 10.33.0
- Python 3
- ffmpeg

```bash
cp .env.example .env
# set AGNES_API_KEY
python3 -m pip install -r audio_analysis/requirements.txt
pnpm install --frozen-lockfile
pnpm dev
```

Web: `http://localhost:5173`
API: `http://localhost:3001`

## Environment

Required for video generation:

```text
AGNES_API_KEY=...
```

Core service values:

```text
PORT=3001
PUBLIC_BASE_URL=http://localhost:3001
WEB_ORIGIN=http://localhost:5173
STORAGE_DIR=./storage
STORAGE_BACKEND=local
WEB_DIST_DIR=
```

Optional S3 storage:

```text
STORAGE_BACKEND=s3
S3_BUCKET=...
S3_REGION=us-east-1
S3_PUBLIC_URL_BASE=https://...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Agnes image/keyframe references must be reachable by Agnes over public HTTPS. EZAv2 converts app-local stored references to provider-facing URLs before generation. When using local storage in production, set `PUBLIC_BASE_URL` to the deployed HTTPS service URL. When using S3, configure a public HTTPS asset base for the upload prefix.

## Render deployment

`render.yaml` is included for a single Render web service.

Build command:

```bash
python3 -m pip install -r audio_analysis/requirements.txt && pnpm install --frozen-lockfile && pnpm build
```

Start command:

```bash
pnpm --filter @mvs/api start
```

Set these in Render:

```text
AGNES_API_KEY=<secret>
PUBLIC_BASE_URL=https://YOUR-SERVICE.onrender.com
WEB_ORIGIN=https://YOUR-SERVICE.onrender.com
WEB_DIST_DIR=apps/web/dist
STORAGE_BACKEND=local
STORAGE_DIR=./storage
```

For durable projects/media across deploys, use S3 or a Render persistent disk. Local service storage is otherwise ephemeral.

Health check: `/health`

## Project structure

```text
apps/web/              React editor, WaveSurfer timeline, Agnes controls
apps/api/              Fastify API, Agnes jobs, storage, FFmpeg render
audio_analysis/        Local librosa song analyzer
packages/shared/       Shared schemas/types
infra/                 Optional AWS infrastructure
```

## Security notes

- `AGNES_API_KEY` stays server-side.
- Agnes completed media is accepted only from a valid HTTPS completion URL.
- Remote provider media is validated before FFmpeg/network use.
- Never commit `.env`, AWS credentials, generated media, or analysis caches.
