# Music Video Studio — Agnes Video V2.0

This is the original Music Video Studio codebase, converted so **Agnes Video V2.0 is the only active AI video generator**.

## Workflow

1. Upload an MP3, WAV, M4A, AAC, FLAC, OGG, or Opus file.
2. The local Python/librosa analyzer returns BPM, beat/downbeat timing, onsets, RMS energy, and song sections.
3. WaveSurfer loads the original song and the editor builds an analysis-driven timeline.
4. Choose one visual mode for each timeline clip:
   - **Text → Video**
   - **Image → Video**
   - **Keyframe → Video** (start + end reference images)
   - **Clip library** (reuse existing footage; no generation)
5. Agnes generations are normalized to silent H.264/YUV420P visuals and hard-trimmed to the timeline duration.
6. Long logical timeline clips are split into internal Agnes-sized segments, stitched, and presented to the editor as one clip.
7. Final Cut uses FFmpeg to assemble the timeline and mux the **original uploaded song** as AAC audio.

## Agnes rules

- Model: `agnes-video-v2.0`
- Output timing: 24 fps
- Frame requests: valid `8n+1` counts
- Maximum provider request: 441 frames
- Long timeline slots are segmented internally and stitched automatically.
- Generated clip audio is not used in Final Cut.

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

Agnes image/keyframe references must be reachable by Agnes over public HTTPS. When using local storage in production, set `PUBLIC_BASE_URL` to the deployed HTTPS service URL. When using S3, configure a public HTTPS asset base for the upload prefix.

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
