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
SYNC_API_KEY=<secret>
AZURE_OPENAI_MAIN_ENDPOINT=https://ezvids-resource.services.ai.azure.com/openai/v1/responses
AZURE_OPENAI_MAIN_API_KEY=<secret>
AZURE_OPENAI_MAIN_DEPLOYMENT=gpt-4.1-mini
AZURE_OPENAI_TTS_ENDPOINT=https://ezvids-resource.openai.azure.com/openai/deployments/gpt-4o-mini-tts/audio/speech?api-version=2025-03-01-preview
AZURE_OPENAI_TTS_API_KEY=<secret>
AZURE_OPENAI_TTS_DEPLOYMENT=gpt-4o-mini-tts
AZURE_OPENAI_TTS_VOICE=alloy
PUBLIC_BASE_URL=https://ezav2.onrender.com
WEB_ORIGIN=https://ezav2.onrender.com
WEB_DIST_DIR=apps/web/dist
STORAGE_BACKEND=s3
STORAGE_DIR=./storage
S3_BUCKET=rendernodock-storage-052080186671-us-east-1-an
S3_REGION=us-east-1
S3_PUBLIC_URL_BASE=https://rendernodock-storage-052080186671-us-east-1-an.s3.us-east-1.amazonaws.com
AWS_ACCESS_KEY_ID=<secret>
AWS_SECRET_ACCESS_KEY=<secret>
```

`AGNES_API_KEY` stays server-side and powers Agnes Video plus Agnes Image generation. `SYNC_API_KEY` is also server-only and is used only when the user manually clicks **Lip-sync to song segment** for a selected clip. Never expose either key in browser environment variables.

`STORAGE_DIR` must remain a local filesystem path even when S3 is enabled; do not put an `s3://...` URI there. S3 addressing belongs in `S3_BUCKET`, `S3_REGION`, and `S3_PUBLIC_URL_BASE`.

The Azure OpenAI main deployment powers Song Understanding. The Azure TTS deployment generates promo narration from the Voiceover script box using Alloy. Keep both Azure API keys server-side. `OPENAI_API_KEY` remains optional and is only needed for the existing automatic lyric transcription path.

Audio analysis is performed by the local `audio_analysis/` Python process during the upload request. The analyzer is downsampled/resource-bounded for the Render service and the browser receives the completed analysis in the successful upload response.
