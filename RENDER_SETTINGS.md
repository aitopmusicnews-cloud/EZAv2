# Render settings

Use the included `render.yaml`, or configure the existing web service with:

**Runtime:** Node

**Build Command**

```text
python3 -m pip install -r audio_analysis/requirements.txt && pnpm install --frozen-lockfile && pnpm build
```

**Start Command**

```text
pnpm --filter @mvs/api start
```

**Health Check**

```text
/health
```

Required environment values:

```text
AGNES_API_KEY=<secret>
PUBLIC_BASE_URL=https://ez-ai-agnes2-0-video-maker.onrender.com
WEB_ORIGIN=https://ez-ai-agnes2-0-video-maker.onrender.com
WEB_DIST_DIR=apps/web/dist
STORAGE_BACKEND=local
STORAGE_DIR=./storage
```

If using S3, replace `STORAGE_BACKEND=local` with the S3 settings documented in `README.md`.

Audio analysis is performed by the local `audio_analysis/` Python/librosa code during the upload request. There is no separate Modal service and no audio-analysis polling loop.
