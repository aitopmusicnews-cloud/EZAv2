# AI Promo Director

Open Promo Mode. Fill in product, audience, verified facts, call to action, creative style and 15/30/60-second length. Create a plan, review its claims and suggested asset matches, edit the script or ask for revisions, then approve it to arrange scenes.

For each missing visual, upload a real asset using Replace or generate an Agnes image from the editable production notes. Real product screens and certificates require uploaded footage; UI-safe mode keeps them static and fully visible. Image generation is per scene, so retries preserve the other scenes. The agent does not invent app screenshots. Agnes remains the image/video provider for the existing music-video workflow.

Choose a narrator, delivery direction (including genre, attitude and pronunciation) and speed. Generate and preview the voiceover, then add your music. Production notes are never speech input. Pre-export checks flag missing media, stale narration, excessive narration duration, text timing, long text and silent/muted tracks. The renderer measures uploaded narration as well, rejects truncation, checks final duration and decodes both output streams before returning a finished URL.

The result is a review render: inspect picture, pronunciation, mix and claims before publishing. This release does not perform semantic video vision review, recognize generated characters, verify advertising claims, or certify audio intelligibility. Asset matches use filenames, not visual inspection. The unrelated music-video Professional Treatment phase remains unchanged.

Both the director draft and current promo edit save in this browser. Generated/uploaded media follows the configured server storage backend; use durable server storage for production. Clearing browser data removes local drafts. Save/download the completed MP4 separately.

## Azure models

Set these **server-side**, then restart the API:

```dotenv
PROMO_AI_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://YOUR-RESOURCE.openai.azure.com
AZURE_OPENAI_API_KEY=YOUR_SERVER_SECRET
AZURE_PROMO_DIRECTOR_DEPLOYMENT=YOUR_TEXT_MODEL_DEPLOYMENT
AZURE_PROMO_SPEECH_DEPLOYMENT=YOUR_GPT_4O_MINI_TTS_DEPLOYMENT
```

Deploy a text model supporting Responses and strict structured outputs, and a `gpt-4o-mini-tts` speech model in Microsoft Foundry. The values above are deployment names, not necessarily model IDs. The endpoint can also end in `/openai/v1/`; Azure `services.ai.azure.com` resource hosts are accepted. This adapter uses Azure API-key authentication. Account quota, region availability and deployment/voice access must be verified in your subscription. No resources are provisioned by this change and Azure is never silently replaced by direct OpenAI.

Planning uses Azure `/openai/v1/responses`; speech uses `/openai/v1/audio/speech?api-version=preview`. References:
- https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle
- https://learn.microsoft.com/en-us/azure/foundry/openai/reference-preview-latest

## Direct OpenAI alternative

```dotenv
PROMO_AI_PROVIDER=openai
OPENAI_API_KEY=YOUR_SERVER_SECRET
PROMO_DIRECTOR_MODEL=gpt-5.6
PROMO_SPEECH_MODEL=gpt-4o-mini-tts
```

No keys enter browser state or project drafts. The existing lyric-analysis credentials and Agnes settings are unchanged. Requests have a two-minute provider timeout and route rate limits; invalid structured plans receive at most one repair attempt. Speech failures are not automatically retried, avoiding duplicate charged requests. Existing app-level access control should restrict access to trusted users before exposing paid generation endpoints publicly.

## Verification

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. With FFmpeg installed and the API built, run `node tests/promo-director-render.test.mjs` to exercise a real synthetic image/music/voice render and verify both tones survive the mix, duration matches, and overlong narration is rejected. Provider tests use mock responses; an Azure-backed render still requires configured deployments and a live acceptance run.
