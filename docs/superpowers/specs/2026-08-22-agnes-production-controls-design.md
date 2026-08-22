# Agnes Production Controls Design

## Goal
Make EZAv2 treat character identity, vehicle identity, spatial continuity, references, and negative guidance as structured generation inputs instead of relying on one free-form prompt.

## Scope
This change keeps Agnes as the only generation provider and preserves existing project/audio/timeline workflows. It adds production controls for image and video generation while remaining backward-compatible with existing saved projects.

## User-facing model

### Production Bible
A project may define reusable production rules:
- lead character profile and reference assets
- hero vehicle profile and reference assets
- global style prompt
- global negative prompt
- default spatial rules

### Reference Assets
Each reference image has a semantic role:
- `character`
- `vehicle`
- `wardrobe`
- `location`
- `style`
- `prop`

References can be locked and reused by scenes.

### Scene Spatial Lock
Each clip may store structured spatial facts such as:
- traffic system
- drive side / driver seat
- passenger seat
- camera position / direction
- vehicle direction
- competitor position / direction
- rearview mirror content
- windshield content
- allow-oncoming-traffic

The UI exposes these as simple production controls; the prompt compiler turns them into explicit Agnes instructions.

### Prompt Compilation
Generation does not directly send the raw scene textarea. A compiler builds a provider-ready request from:
1. hard spatial constraints
2. character lock
3. vehicle lock
4. scene prompt
5. camera/lighting/style guidance
6. global + scene negatives

The inspector shows the exact compiled prompt, negatives, references, mode, and dimensions that Agnes will receive.

## Agnes image generation
Extend image generation from text-only to three modes:
- `text2img`: prompt only
- `img2img`: one reference image
- `compose`: multiple reference images

The request supports `referenceImages[]` and `mode`. Existing text-only calls continue to work.

## Agnes video generation
Add `negativePrompt` to text-to-video, image-to-video, and keyframe-to-video requests. The backend forwards it as `negative_prompt` to Agnes.

## Persistence
Projects persist:
- `productionBible`
- `referenceAssets`
- per-clip `spatialLock`
- per-clip `negativePrompt`
- per-clip `referenceAssetIds`
- per-clip compiled prompt metadata when generated

Historical snapshots without these fields remain valid.

## Compatibility
- Existing `characterImageUrl` and `lookbook` continue to load.
- Existing clips with only `prompt` continue to generate.
- Existing image generation remains text-only unless references are selected.

## Validation
Before generation, the client validates simple contradictions such as:
- driver seat conflicts with left-hand-drive defaults
- competitors marked behind while windshield is configured to show them
- oncoming traffic disabled while competitor direction is oncoming

Validation should warn/block only obvious contradictions; it cannot guarantee model compliance.

## Testing
Add tests for:
- schema backward compatibility
- prompt compiler ordering and spatial language
- contradiction detection
- image request mode/reference serialization
- video negative prompt forwarding
- scheduler preservation of new generation fields
- Sidebar contract presence for production controls and request inspector

## Non-goals
- No new AI provider.
- No automatic computer-vision identity scoring.
- No guarantee that Agnes always obeys spatial constraints.
- No full storyboard authoring subsystem in this change.
