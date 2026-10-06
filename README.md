# EZAv2 — Professional Music Video Director

EZAv2 is an audio-aware music-video production app built around **BeatSync**, **Agnes Video V2.0**, local music analysis, Azure/OpenAI-assisted planning, and FFmpeg final rendering.

## Current modes

### Professional Music Video Director

The main guided workflow is **Song → Lyrics → Understanding → Treatment → Plan → Images → Takes → Edit → Final**.

- Upload MP3, WAV, M4A, AAC, FLAC, OGG, or Opus.
- Transcribe with Azure Whisper, paste/align official lyrics, or mark the track instrumental.
- Approve Song Understanding before Professional Treatment.
- Pick a Director style and use Director revision chat for creative changes.
- Review the Production Bible, up to 3 Character Locks, Asset Locks, and per-shot assignments.
- Generate/approve storyboard images, then Agnes moving video takes.
- Final Cut renders the MP4 with the original uploaded song, then exposes **Preview MP4** and **Download MP4**.
- Professional Director output does **not** add titles, captions, lyrics, lower-thirds, subtitles, or other burned-in text.

### Music Video Promo

**Music Video Promo is a song/artist teaser, not a product ad. It does not require product information.**

Open **Treatment → Create a Music Video Promo**. Choose only:

- 15s, 30s, 60s, or custom 5–120s length (never longer than the uploaded song)
- platform/video size

The Director automatically uses the approved Song Understanding, song timing, Director vision, selected style, Character Locks, Asset Locks, and continuity rules. It then continues through Plan → Images → Takes → Edit → Final.

No product website, product name, product facts, audience field, or marketing CTA is required.

**No on-screen text is automatically added.** Music Video Promo output should contain visuals + music only: no titles, captions, lyrics, lower-thirds, subtitles, slogans, or burned-in promo copy.

### Product Promo Video

Open **Treatment → Create a Product Promo Video** for an app, service, website, business, or product.

This separate mode can use a website import, product name, reviewed facts/qualifications, audience, casting direction, CTA, length, and platform size. Website text is treated as untrusted data and must be reviewed before the Director uses it.

### Manual Promo Builder

Open **Manual Promo Builder** or `/promo` for the hands-on social promo editor. It supports up to 10 image/video scenes, reordering, durations, image motion, crop/focal controls, UI-safe handling, music, Azure TTS voiceover, music ducking, and MP4 export.

The Manual Promo Builder is the only place where on-screen text may be added intentionally by the user. It is never added automatically by the Professional Director.

Production notes remain separate from voiceover and are not intentionally spoken.

### Advanced Editor

The Advanced Editor exposes lower-level timeline controls for Text → Image, Text → Video, Image → Video, Keyframe → Video, library footage, and uploads.

### Character and Asset Locks

The current Professional Director supports up to **3 Character Locks**, Asset Locks for vehicle/wardrobe/prop/location/product/style, per-shot lock assignment, Production Bible continuity, spatial-lock rules, and negative-prompt continuity controls.

Each assigned Character Lock represents one unique person. Director image/video prompts explicitly prohibit cloned bodies, duplicate faces, twin copies, repeated performers, or extra copies of the same locked identity. Reflections are allowed only when the shot explicitly calls for one and must remain a reflection, not a second physical character.

At least one active Character Lock with a valid reference image is currently required before Professional Director storyboard generation begins.

### Platform formats

| Format | Output | Typical use |
| --- | --- | --- |
| `9:16` | `720×1280` | TikTok, Reels, YouTube Shorts |
| `4:5` | `720×900` | Instagram/Facebook feed |
| `1:1` | `720×720` | Square social feed |
| `16:9` | `1280×720` | YouTube, websites, landscape |

The selected format is passed into Agnes generation for Director promo takes and into the final renderer.

## Advanced Editor workflow

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

## Environment configuration

There is currently no committed `.env.example`; create `.env` manually at the repository root for local development.

### Core runtime

```text
PORT=3001
PUBLIC_BASE_URL=http://localhost:3001
WEB_ORIGIN=http://localhost:5173
WEB_DIST_DIR=
STORAGE_DIR=./storage
STORAGE_BACKEND=local
```

`WEB_ORIGIN` can be one URL or a comma-separated list of allowed origins. In a single-service production deployment, set `WEB_DIST_DIR=apps/web/dist` and make `PUBLIC_BASE_URL` / `WEB_ORIGIN` match the deployed HTTPS host.

### Generation / AI provider variables

```text
AGNES_API_KEY=...
SYNC_API_KEY=...

AZURE_OPENAI_MAIN_ENDPOINT=...
AZURE_OPENAI_MAIN_API_KEY=...
AZURE_OPENAI_MAIN_DEPLOYMENT=gpt-4.1-mini

AZURE_OPENAI_TRANSCRIPTION_ENDPOINT=...
AZURE_OPENAI_TRANSCRIPTION_API_KEY=...

AZURE_OPENAI_TTS_ENDPOINT=...
AZURE_OPENAI_TTS_API_KEY=...
AZURE_OPENAI_TTS_DEPLOYMENT=gpt-4o-mini-tts
AZURE_OPENAI_TTS_VOICE=alloy

OPENAI_API_KEY=...
SONG_UNDERSTANDING_MODEL=gpt-5.6
```

Current behavior:

- `AGNES_API_KEY` is required for Agnes image/video generation.
- `SYNC_API_KEY` is optional and only needed for manual lip-sync.
- Professional Treatment requires the Azure OpenAI main deployment.
- Song Understanding prefers Azure OpenAI main and can fall back to `OPENAI_API_KEY`.
- Azure transcription uses `AZURE_OPENAI_TRANSCRIPTION_API_KEY`, falling back to `AZURE_OPENAI_MAIN_API_KEY` when the dedicated key is absent.
- Azure TTS uses `AZURE_OPENAI_TTS_API_KEY`, falling back to `AZURE_OPENAI_MAIN_API_KEY` when the dedicated key is absent.
- `AZURE_OPENAI_MAIN_ENDPOINT` is the full endpoint used by the current Azure Responses call, not merely a resource hostname.
- The checked-in config has default Whisper/TTS endpoints for the existing `ezvids-resource`; override them for another Azure resource/subscription.

### Storage

Production media should use S3 with the current codebase:

```text
STORAGE_BACKEND=s3
S3_BUCKET=...
S3_REGION=...
S3_PUBLIC_URL_BASE=https://...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

The current storage backend supports only `local` and `s3`. Azure Blob Storage is not yet implemented, so an Azure-hosted deployment should still use S3 for durable uploads/renders unless Azure Blob support is added.

Reference images sent to Agnes must be reachable over public HTTPS. Configure media CORS so browser Preview/Download and provider GET/HEAD requests work.

## Final MP4 / job behavior

Professional Director Final Cut uses the sequential FFmpeg renderer to reduce hosted-memory pressure. It renders slices sequentially, preserves gaps/ordering, discards generated clip audio, muxes the **original uploaded song** as AAC, writes fast-start MP4 output, cleans temporary files, and exposes Preview/Download.

The render and generation queues are currently process-local. Keep deployments at **one replica** until those queues are moved to shared durable infrastructure.

## Local development

Requirements: Node.js 22+, pnpm 10.33.0, Python 3, and ffmpeg.

```bash
git clone https://github.com/aitopmusicnews-cloud/EZAv2.git
cd EZAv2
python3 -m pip install -r audio_analysis/requirements.txt
pnpm install --frozen-lockfile
# create .env manually at repo root
pnpm dev
```

Development URLs: web `http://localhost:5173`, API `http://localhost:3001`, health `http://localhost:3001/health`.

Verification:

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Current Render deployment

Render is the current active deployment target. `render.yaml` defines one Node web service.

```text
Service: EZAv2
Node: 22.16.0
Health: /health

Build:
python3 -m pip install -r audio_analysis/requirements.txt && pnpm install --frozen-lockfile && pnpm build

Start:
pnpm --filter @mvs/api start

Production web:
WEB_DIST_DIR=apps/web/dist
STORAGE_BACKEND=s3
```

Keep Agnes, Sync, Azure/OpenAI, and AWS storage credentials as service secrets; never commit them.

## AWS deployment

### Current AWS repo status

The repository contains an existing Terragrunt/Terraform stack under `infra/` for:

```text
ECR
  ↓
ECS Fargate (1 task, 2 vCPU / 4 GB)
  ↓
Application Load Balancer
  ↓
CloudFront

S3             durable uploads/renders
CloudWatch     logs
SSM            provider secrets
```

The current AWS infra is configured for `us-west-2` and one ECS task, which matches the process-local job queues.

### AWS parity warning

The AWS infrastructure predates the current Director/Azure configuration and is **not yet a drop-in deploy from current `main`**.

Before using it:

1. Restore/add `apps/api/Dockerfile`. `infra/scripts/bootstrap-ecr.sh` references that file, but it is not currently present on `main`.
2. Update `infra/modules/service/main.tf` so ECS receives the current Azure/OpenAI/Sync variables. The checked-in task currently wires `AGNES_API_KEY` plus runtime/storage values, not the full current provider set.
3. Keep `desired_count = 1` until job queues are externalized.

### AWS prerequisites

Install AWS CLI, Docker, Terraform, and Terragrunt, then verify credentials:

```bash
aws sts get-caller-identity
```

### AWS secrets

The existing stack uses SSM Parameter Store. Store the keys used by the current workflow as `SecureString` values, for example:

```bash
aws ssm put-parameter --name /music-video-studio/hackathon/AGNES_API_KEY --value 'YOUR_KEY' --type SecureString --overwrite --region us-west-2
aws ssm put-parameter --name /music-video-studio/hackathon/AZURE_OPENAI_MAIN_API_KEY --value 'YOUR_KEY' --type SecureString --overwrite --region us-west-2
aws ssm put-parameter --name /music-video-studio/hackathon/AZURE_OPENAI_TRANSCRIPTION_API_KEY --value 'YOUR_KEY' --type SecureString --overwrite --region us-west-2
aws ssm put-parameter --name /music-video-studio/hackathon/AZURE_OPENAI_TTS_API_KEY --value 'YOUR_KEY' --type SecureString --overwrite --region us-west-2
```

Optional secrets include `SYNC_API_KEY` and `OPENAI_API_KEY`. Put Azure endpoints/deployment names in SSM String parameters or ECS environment variables.

ECS can inject SSM parameters through task-definition `secrets`. Rotating an SSM value does not update an already-running task; force a new deployment after rotation.

### AWS first deployment

After the Dockerfile and env/secret parity work are complete:

```bash
cd infra/envs/hackathon
terragrunt -working-dir networking apply
terragrunt -working-dir ecr apply
terragrunt -working-dir alb apply
terragrunt -working-dir cluster apply
terragrunt -working-dir storage apply

cd ../../..
infra/scripts/bootstrap-ecr.sh

cd infra/envs/hackathon
terragrunt -working-dir service apply
terragrunt -working-dir cloudfront apply
terragrunt -working-dir service apply
```

The second service apply lets `WEB_ORIGIN` pick up the CloudFront domain. After bootstrap, `terragrunt run-all apply` can re-apply the stack.

### AWS subsequent deployment

```bash
infra/scripts/deploy-image.sh
# or
infra/scripts/deploy-image.sh v0.0.2
```

The script pushes to ECR, forces a new ECS deployment, and invalidates CloudFront. Health endpoint: `/health`. See `infra/README.md` for the detailed Terraform layout.

## Azure deployment

### Recommended target: Azure Container Apps

Azure Container Apps is the recommended Azure host because EZAv2 needs Node, Python/librosa, ffmpeg, a long-running API, server-side secrets, and generated-media storage.

### Azure repo status

There is no Azure infrastructure-as-code directory committed today. For production, use a custom container image. Azure can build some Node apps from source without a Dockerfile, but EZAv2 also needs Python audio-analysis packages and ffmpeg, so a controlled container image is safer.

The current repo does not contain the production Dockerfile expected by the old AWS scripts. Add/restore one before following the container deployment commands.

A production image must include Node 22, pnpm 10.33.0, Python 3, `audio_analysis/requirements.txt`, ffmpeg, `pnpm install --frozen-lockfile`, `pnpm build`, and must start `pnpm --filter @mvs/api start` while serving `apps/web/dist`.

### Azure base resources

```bash
RESOURCE_GROUP=ezav2-rg
LOCATION=westus2
CONTAINER_ENV=ezav2-env
CONTAINER_APP=ezav2
ACR_NAME=ezav2registryUNIQUE
IMAGE_TAG=latest

az login
az group create --name $RESOURCE_GROUP --location $LOCATION
az acr create --name $ACR_NAME --resource-group $RESOURCE_GROUP --sku Basic
az containerapp env create --name $CONTAINER_ENV --resource-group $RESOURCE_GROUP --location $LOCATION

az acr build --registry $ACR_NAME --image ezav2:$IMAGE_TAG .
```

### Azure ACR pull identity

Use a managed identity for ACR pull instead of registry passwords:

```bash
IDENTITY_ID=$(az identity create --name ezav2-pull --resource-group $RESOURCE_GROUP --query id -o tsv)
PRINCIPAL_ID=$(az identity show --name ezav2-pull --resource-group $RESOURCE_GROUP --query principalId -o tsv)
ACR_ID=$(az acr show --name $ACR_NAME --resource-group $RESOURCE_GROUP --query id -o tsv)
az role assignment create --assignee-object-id $PRINCIPAL_ID --assignee-principal-type ServicePrincipal --role AcrPull --scope $ACR_ID
```

Create the app with one replica and port 8080:

```bash
az containerapp create \
  --name $CONTAINER_APP \
  --resource-group $RESOURCE_GROUP \
  --environment $CONTAINER_ENV \
  --image $ACR_NAME.azurecr.io/ezav2:$IMAGE_TAG \
  --registry-server $ACR_NAME.azurecr.io \
  --user-assigned $IDENTITY_ID \
  --registry-identity $IDENTITY_ID \
  --ingress external \
  --target-port 8080 \
  --min-replicas 1 \
  --max-replicas 1 \
  --env-vars PORT=8080 WEB_DIST_DIR=apps/web/dist STORAGE_BACKEND=s3
```

Get the hostname and set the public URLs:

```bash
FQDN=$(az containerapp show --name $CONTAINER_APP --resource-group $RESOURCE_GROUP --query properties.configuration.ingress.fqdn -o tsv)
az containerapp update --name $CONTAINER_APP --resource-group $RESOURCE_GROUP --set-env-vars PUBLIC_BASE_URL=https://$FQDN WEB_ORIGIN=https://$FQDN
```

Container Apps exposes public HTTPS ingress and forwards it to the configured target port.

### Azure secrets and environment values

Create secret values:

```bash
az containerapp secret set \
  --name $CONTAINER_APP \
  --resource-group $RESOURCE_GROUP \
  --secrets \
    agnes-api-key='YOUR_AGNES_KEY' \
    azure-main-key='YOUR_AZURE_MAIN_KEY' \
    azure-transcription-key='YOUR_AZURE_TRANSCRIPTION_KEY' \
    azure-tts-key='YOUR_AZURE_TTS_KEY' \
    aws-access-key-id='YOUR_AWS_ACCESS_KEY' \
    aws-secret-access-key='YOUR_AWS_SECRET_KEY'
```

Map secrets into app environment variables:

```bash
az containerapp update \
  --name $CONTAINER_APP \
  --resource-group $RESOURCE_GROUP \
  --set-env-vars \
    AGNES_API_KEY=secretref:agnes-api-key \
    AZURE_OPENAI_MAIN_API_KEY=secretref:azure-main-key \
    AZURE_OPENAI_TRANSCRIPTION_API_KEY=secretref:azure-transcription-key \
    AZURE_OPENAI_TTS_API_KEY=secretref:azure-tts-key \
    AWS_ACCESS_KEY_ID=secretref:aws-access-key-id \
    AWS_SECRET_ACCESS_KEY=secretref:aws-secret-access-key
```

Then add non-secret endpoints/deployments/storage values:

```bash
az containerapp update \
  --name $CONTAINER_APP \
  --resource-group $RESOURCE_GROUP \
  --set-env-vars \
    AZURE_OPENAI_MAIN_ENDPOINT='YOUR_FULL_AZURE_MAIN_ENDPOINT' \
    AZURE_OPENAI_MAIN_DEPLOYMENT='gpt-4.1-mini' \
    AZURE_OPENAI_TRANSCRIPTION_ENDPOINT='YOUR_WHISPER_ENDPOINT' \
    AZURE_OPENAI_TTS_ENDPOINT='YOUR_TTS_ENDPOINT' \
    AZURE_OPENAI_TTS_DEPLOYMENT='gpt-4o-mini-tts' \
    AZURE_OPENAI_TTS_VOICE='alloy' \
    S3_BUCKET='YOUR_BUCKET' \
    S3_REGION='YOUR_REGION' \
    S3_PUBLIC_URL_BASE='https://YOUR_PUBLIC_MEDIA_BASE'
```

Add `SYNC_API_KEY` and `OPENAI_API_KEY` as secret references when those optional paths are used.

Azure Blob is not a current EZAv2 storage backend, so this Azure deployment still uses S3 for durable media.

### Azure health and updates

The app exposes `GET /health`. Configure Container Apps startup/readiness/liveness probes against `/health` when using custom HTTP probes.

Keep min/max replicas at 1 initially because render/generation queues are process-local.

Build and deploy later revisions with an immutable tag:

```bash
IMAGE_TAG=2026-10-05-1
az acr build --registry $ACR_NAME --image ezav2:$IMAGE_TAG .
az containerapp update --name $CONTAINER_APP --resource-group $RESOURCE_GROUP --image $ACR_NAME.azurecr.io/ezav2:$IMAGE_TAG
```

## Deployment checklist

- `/health` returns HTTP 200
- production SPA loads from the API host
- `PUBLIC_BASE_URL` matches the public API/media origin
- `WEB_ORIGIN` contains all allowed web origins
- S3 uploads/renders survive service redeploys
- media CORS supports Preview/Download
- Agnes can fetch locked references over public HTTPS
- Azure Whisper transcription works
- Song Understanding works
- Professional Treatment works
- storyboard and Agnes take generation work
- final MP4 contains the original song
- Preview MP4 and Download MP4 work
- Music Video Promo works without product fields
- Product Promo Video keeps reviewed marketing facts separate
- 9:16 / 4:5 / 1:1 / 16:9 exports render correctly

## Security notes

- Keep all provider/API keys server-side.
- Never commit `.env`, AWS credentials, Azure keys, Agnes keys, Sync keys, generated media, or analysis caches.
- Use SSM/Container Apps secrets for production keys.
- Website imports are untrusted data and stay review-gated.
- Rotate leaked keys and redeploy/restart so new values reach the running process.

## Deployment references

- AWS ECS/Fargate: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/getting-started-fargate.html>
- AWS SSM secrets in ECS: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-ssm-paramstore.html>
- Azure Container Apps build/deploy: <https://learn.microsoft.com/azure/container-apps/tutorial-deploy-from-code>
- Azure Container Apps environment variables/secrets: <https://learn.microsoft.com/azure/container-apps/environment-variables>
- Azure Container Apps ingress: <https://learn.microsoft.com/azure/container-apps/ingress-how-to>
- Azure Container Apps health probes: <https://learn.microsoft.com/azure/container-apps/health-probes>
