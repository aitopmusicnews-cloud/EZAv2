# EZAv2 Professional Music Video Director — Design Spec

Date: 2026-08-27
Status: Proposed for user review
Branch: `design/professional-music-video-director`

## 1. Problem

The current BeatSync Director in EZAv2 is not sufficient for professional music-video production. Its live planner receives `AudioAnalysis + vision + ProductionBible`, but no lyric or semantic song context. It assigns editorial roles primarily from BPM, energy, section timing, and position, then cycles through generic camera, framing, mood, and shot-language presets.

That is useful for rough pacing, but it cannot reliably understand what a song is about, why a lyric matters, which visual ideas should recur, or how a treatment should evolve from beginning to end. The result can feel disconnected from the actual song.

The Professional Director must replace that heuristic-first workflow with a staged creative pipeline in which audio timing, lyrics, semantic interpretation, treatment, production design, scene structure, coverage, generation references, continuity, takes, and editing all have separate responsibilities and explicit user approval gates.

## 2. Product Goal

EZAv2 should behave like a professional AI music-video pre-production, generation, and editing workspace rather than a prompt box plus timeline.

The user should be able to upload a song and move through a guided process:

`Song -> Lyrics -> Song Understanding -> Treatment -> Production Bible -> Scenes -> Shots -> Storyboard Images -> Video Takes -> Edit Versions -> Final Export`

BeatSync is the creative/music-aware Director brain. Agnes remains the visual-generation execution engine. EZAv2 remains the main workspace and persistence/rendering shell.

## 3. Core Principles

### 3.1 No fake song understanding

BeatSync must not claim to understand lyrical meaning when it only has BPM/energy/section data.

Audio-only analysis may drive:
- beat/downbeat timing,
- section boundaries,
- dynamics,
- pacing,
- cut opportunities,
- performance intensity,
- edit rhythm.

It must not invent:
- lyrical themes,
- narrative characters,
- relationships,
- metaphors,
- story meaning,
- lyric-specific visual concepts.

For songs with vocals, professional planning requires lyric/semantic context before the treatment is considered ready.

For instrumental songs, the user must explicitly confirm Instrumental Mode. In that mode the Director may build meaning from musical structure plus the user's stated creative vision, but must label that interpretation as creative direction rather than lyric-derived meaning.

### 3.2 Approval before expensive generation

No Agnes image or video generation occurs until the relevant creative stage has been approved.

Required gates:
1. Approve Song Understanding.
2. Approve Creative Treatment.
3. Approve Production Bible + Scene Plan + Shot Plan.
4. Approve storyboard images before video generation.
5. Approve/select video takes before edit rendering.
6. Approve an edit version before final export.

### 3.3 Edit ideas, not raw prompts

The normal workflow exposes creative controls in plain English. Raw Agnes prompts, negative prompts, request inspection, and low-level provider controls remain available under Advanced.

### 3.4 Scenes first, shots second

The Director must build coherent scenes and visual setups before individual shots. Shots inherit scene identity, wardrobe, lighting, props, location, references, and continuity rules.

### 3.5 Intentional repetition beats random variety

Professional music videos need recurring worlds, motifs, setups, and hero footage. BeatSync should deliberately reuse approved scenes and evolve them across song sections instead of generating a new unrelated world for every cut.

### 3.6 Creative decisions require reasons

The Director must not choose camera, framing, scene, wardrobe, location, or shot role by cycling through canned presets. Every scene and shot must store a concise creative rationale tied to at least one of:
- approved treatment,
- lyric meaning,
- musical structure,
- narrative progression,
- performance purpose,
- coverage need,
- continuity need,
- repeated-section evolution.

BPM and energy may influence pace/intensity, but cannot select the story or visual concept by themselves.

## 4. High-Level Architecture

### 4.1 Existing EZAv2 responsibilities retained

Keep the existing working infrastructure for:
- song upload,
- local audio analysis,
- Production Bible storage,
- reference assets,
- prompt compilation,
- spatial locks,
- Agnes image generation,
- Agnes video generation,
- generated clip storage,
- timeline clips,
- project persistence,
- FFmpeg final assembly,
- original-song mux,
- advanced manual editor.

### 4.2 New/expanded BeatSync subsystems

Add these logical layers above the existing generation stack:

1. `LyricIngestService`
2. `LyricAlignmentService`
3. `SongUnderstandingService`
4. `TreatmentDirector`
5. `ScenePlanner`
6. `ShotCoveragePlanner`
7. `ProductionBibleDirector`
8. `ReferenceResolver`
9. `ContinuityEvaluator`
10. `TakeManager`
11. `EditDirector`
12. `EditVersionManager`

These can be implemented incrementally, but the data contracts must support the complete pipeline from the beginning.

## 5. Lyrics and Transcription

### 5.1 Hybrid lyric workflow

The approved workflow is:

1. Upload song.
2. Run normal audio analysis.
3. Submit the song to an external transcription provider through a provider adapter.
4. Display the transcription as a draft with timing.
5. Allow the user to paste or upload official lyrics.
6. If official lyrics are provided, align them to the transcribed timing and use the official wording as authoritative.
7. Let the user correct lyrics before semantic analysis.

The transcription provider must be abstracted behind an interface so the app is not permanently tied to one vendor.

### 5.2 Lyric data model

The project should persist a lyric document similar to:

```ts
interface LyricDocument {
  source: "transcription" | "official" | "hybrid" | "instrumental";
  rawText: string;
  language?: string;
  segments: LyricSegment[];
  correctedAt?: string;
  approvedAt?: string;
}

interface LyricSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  confidence?: number;
  source: "transcription" | "official-aligned" | "manual";
}
```

No treatment generation is unlocked until lyrics are approved, unless Instrumental Mode has been explicitly selected.

## 6. Song Understanding

### 6.1 Purpose

Song Understanding is the semantic bridge between raw music/lyrics and creative direction.

It combines:
- aligned lyrics,
- section timing,
- BPM,
- beats/downbeats,
- RMS/dynamics,
- repetition,
- pauses/breaks,
- user creative vision,
- optional artist/style references.

### 6.2 Required output

Persist a structured `SongUnderstanding` object containing at minimum:

- primary theme,
- secondary themes,
- emotional arc,
- section map,
- important lyric moments with timestamps,
- repeated hook/refrain lines,
- characters/relationships if present,
- narrative perspective,
- literal imagery,
- symbolic/metaphorical imagery,
- tension/release moments,
- performance opportunities,
- visual motifs suggested by the material,
- uncertainty notes.

The UI must show this summary before treatment creation.

### 6.3 Approval UI

The user sees:

- Theme
- Emotional Arc
- Key Lyrics
- Section Map
- Narrative
- Visual Motifs
- Performance Moments
- Uncertainties / corrections needed

Actions:
- Edit Understanding
- Re-analyze
- Approve Song Understanding

Any edit invalidates downstream treatment approval and downstream generated creative artifacts as appropriate.

## 7. Creative Treatment Director

### 7.1 Director mode

Default strategy: Hybrid Director.

Supported video-type controls:
- Auto
- Performance
- Narrative
- Performance + Narrative
- Fashion / Visual
- Experimental

Auto may recommend one of the other types and explain why.

### 7.2 Hybrid Director behavior

The Hybrid Director combines:
- selected literal lyric moments,
- narrative progression,
- artist performance,
- symbolism,
- recurring visual motifs,
- fashion/production design,
- musical spectacle,
- section-aware escalation.

It must not illustrate every lyric literally.

### 7.3 Treatment data

A professional treatment contains:

- Core Concept
- Story / progression
- Artist Role
- Visual World
- Visual Motifs
- Performance Language
- Narrative Language
- Camera Language
- Editing Rhythm
- Key Lyric Moments
- Hero Moments
- Ending / payoff

The treatment becomes the creative source of truth for the Production Bible, scenes, and storyboard.

### 7.4 Treatment approval

Required actions:
- Edit treatment section
- Re-direct treatment
- Change Video Type
- Approve Treatment

Any material treatment edit invalidates downstream Production Bible/scene/shot approval.

## 8. Production Bible

### 8.1 Project-specific, never hardwired

The Production Bible is generated from the approved treatment and references, then edited/approved by the user.

It must not assume cars, driving, left/right seating, fixed locations, or other scenario-specific spatial rules.

Spatial rules default to `Auto / None` until a particular scene requires them.

### 8.2 Required fields

At minimum:
- Artist / character identity
- Wardrobe profiles
- Locations / sets
- Props
- Vehicles, only if used
- Visual style
- Color palette
- Lighting language
- Camera/lens language
- Continuity rules
- Reference-asset bindings
- Global Negative Prompt
- Optional spatial locks

### 8.3 Global Negative Prompt

Global Negative Prompt is mandatory.

Rules:
- It is editable per project.
- Plan approval is blocked if it is blank.
- It is inherited by every Agnes image and video generation request.
- It merges with scene-specific, shot-specific, and spatial negative guidance.
- Repeated clauses are de-duplicated before provider submission.
- Raw merged negatives are inspectable under Advanced.

## 9. Scene-First Planning

### 9.1 Scene model

A scene is a reusable production setup, not merely a timeline interval.

Example fields:

```ts
interface DirectorScene {
  id: string;
  title: string;
  purpose: string;
  rationale: string;
  songSectionIds: string[];
  locationId?: string;
  wardrobeId?: string;
  lightingSetup: string;
  artistState: string;
  visualMotifs: string[];
  continuityRules: string[];
  referenceAssetIds: string[];
  evolutionStage?: "introduce" | "develop" | "escalate" | "payoff";
}
```

### 9.2 Chorus/repeated-section evolution

Repeated sections should deliberately evolve.

Example:
- Chorus 1: introduce hero setup.
- Chorus 2: same world, new angle/movement/intensity.
- Final Chorus: maximum scale, strongest performance, payoff image.

The planner should preserve recognizable continuity while increasing visual stakes.

## 10. Coverage-Based Shot Planning

### 10.1 Shot families

Each scene can produce a coverage family such as:
- Master / Establishing
- Hero Performance
- Medium Performance
- Close Performance
- Narrative
- Reaction
- Insert / Detail
- Transition
- Texture / B-roll
- Lyric Emphasis
- Finale

A scene may share one approved setup across several framings and motion variants.

### 10.2 Shot budget

BeatSync must plan a controlled source-shot budget rather than one generated clip per potential edit point.

For a typical ~3 minute song, a reasonable default target is approximately 20–35 distinct source shots, adjusted by:
- BPM/pacing,
- number of scenes,
- performance/narrative balance,
- coverage needs,
- repeated sections,
- hero-shot requirements,
- desired edit density.

The final edit can reuse, trim, reorder, and revisit approved hero footage rather than generating 50–60 unrelated clips.

### 10.3 Shot data

Each `DirectorShot` should reference its parent scene and include:
- purpose/role,
- creative rationale,
- source song section,
- lyric moment(s), if relevant,
- subject/action,
- camera movement,
- framing/lens intent,
- duration target,
- intensity,
- narrative/performance designation,
- required references,
- continuity constraints,
- hero priority,
- take count target.

### 10.4 No canned shot cycling

The professional planner must not implement coverage by incrementing through arrays such as `CAMERA_CYCLE` or `FRAMING_CYCLE` as the primary decision mechanism. A reusable option library is acceptable only after the Director has established why a shot exists and what visual function it must serve.

The UI should expose `Why this shot?` from the stored rationale when the user wants to inspect the Director's decision.

## 11. Prompt Compilation

### 11.1 Source hierarchy

Agnes prompts are compiled from approved structured intent in this order:

`Song Understanding -> Treatment -> Production Bible -> Scene -> Shot -> Provider Prompt`

Provider prompts are outputs, not the editable source of truth.

### 11.2 Image prompt emphasis

Storyboard image prompts establish:
- artist/subject identity,
- wardrobe,
- location,
- set/props,
- lighting,
- composition,
- framing,
- style,
- continuity,
- scene-specific visual motif.

### 11.3 Video prompt emphasis

After an image is approved, image-to-video prompts should focus on:
- subject movement,
- performance behavior,
- camera movement,
- environmental motion,
- timing/intensity,
- continuity constraints,
- Global Negative Prompt.

The video model should not be asked to reinvent the scene already locked by the approved image.

## 12. Reference Hierarchy

Each shot automatically receives only the references it needs.

Supported reference categories:
- artist identity,
- wardrobe,
- location/set,
- prop,
- vehicle,
- style,
- previous approved frame when continuity requires it.

The `ReferenceResolver` derives the effective reference set from Production Bible + Scene + Shot.

The normal UI should show which references are active, but users should not have to manually attach the same references to every shot.

## 13. Storyboard Image Review

### 13.1 Image-first generation

Every planned shot receives a key storyboard image before video generation.

Per-image actions:
- Approve
- Regenerate
- Change Idea
- Change Camera
- Change Wardrobe
- Change Location
- More Like This
- Lock

Approved images become the visual lock for video generation.

### 13.2 Selective invalidation

Changing one shot should not restart the whole project.

Rules:
- Changing a shot invalidates only that shot's image/video/take approval.
- Changing a scene-level identity field invalidates affected shots in that scene.
- Changing a global Production Bible identity/style field marks all dependent shots stale.
- Previously generated assets should remain visible as history/versions rather than being silently deleted.

## 14. Continuity Quality Control

### 14.1 Continuity evaluator

The system should evaluate generated images/takes for likely mismatches such as:
- artist identity drift,
- wardrobe drift,
- wrong vehicle/prop,
- unexpected location change,
- wrong subject count,
- duplicate people,
- inconsistent time of day,
- lighting-direction mismatch,
- spatial continuity violations.

### 14.2 Human-in-the-loop

Continuity checks are advisory, not absolute truth.

UI example:

- Identity: Pass / Review
- Wardrobe: Pass / Review
- Location: Pass / Review
- Props: Pass / Review
- Scene Match: Pass / Review

The user remains the final approver.

## 15. Video Takes

### 15.1 Multiple takes where they matter

Normal coverage may generate one take by default.

High-priority hero shots may request 2–3 takes intentionally.

Each take stores:
- provider request metadata,
- prompt snapshot,
- reference snapshot,
- video URL,
- generation status,
- continuity evaluation,
- selected/approved state.

### 15.2 Take selection

For hero shots, the UI supports:
- preview Take A/B/C,
- select Hero Take,
- regenerate one take,
- change motion and regenerate,
- preserve rejected takes in history.

## 16. BeatSync Edit Director

### 16.1 Editing inputs

The Edit Director uses only approved footage and combines:
- beat/downbeat map,
- musical section boundaries,
- lyric emphasis timestamps,
- narrative continuity,
- performance continuity,
- shot variety,
- chorus repetition/evolution,
- hero footage,
- breathing room,
- original song.

### 16.2 No one-shot “final” render

The first assembly is `Edit V1`, not automatically Final.

Users can request high-level revisions such as:
- More performance
- More story
- Faster chorus
- Slower verse
- Hold this shot longer
- Replace shot 14
- Use Take B
- Less cutting

Each revision creates a new immutable edit version referencing the same approved source assets unless a shot is explicitly regenerated.

### 16.3 Edit version data

Persist:
- version number,
- source shot/take selections,
- timeline decisions,
- revision instruction,
- render URL,
- approval state,
- created timestamp.

## 17. UI Flow

The main guided workflow should evolve from the current five-step shell into:

1. Song
2. Lyrics
3. Understanding
4. Treatment
5. Plan
6. Images
7. Takes
8. Edit
9. Final

The interface can visually group related steps to avoid feeling overwhelming, but each approval state must be explicit.

### 17.1 Plan step contains

- Production Bible
- Scene list
- Shot list
- Shot budget summary
- reference summary
- Global Negative Prompt

Primary action:
`Approve Production Bible + Storyboard Plan`

## 18. State Machine / Approval Rules

Suggested top-level stages:

```ts
type DirectorStage =
  | "song"
  | "lyrics"
  | "understanding"
  | "treatment"
  | "plan"
  | "images"
  | "takes"
  | "edit"
  | "final";
```

Unlock rules:
- `lyrics`: song uploaded/analyzed.
- `understanding`: lyric document approved or Instrumental Mode confirmed.
- `treatment`: Song Understanding approved.
- `plan`: Treatment approved.
- `images`: Production Bible + scenes + shots approved and Global Negative Prompt non-empty.
- `takes`: required storyboard images approved.
- `edit`: required source takes approved/selected.
- `final`: an edit version approved.

No later stage can silently bypass an earlier approval gate.

## 19. Persistence and Versioning

Project snapshots must persist all Director artifacts:
- lyric document,
- Song Understanding,
- treatment versions,
- Production Bible,
- scenes,
- shots,
- storyboard image versions,
- take versions,
- continuity reports,
- edit versions,
- final export metadata.

Every approved artifact should keep a version/snapshot so downstream provider requests can be traced back to exactly what was approved.

## 20. Failure Handling

### 20.1 Transcription failure

If transcription fails:
- show the error clearly,
- allow retry,
- allow official lyrics/manual lyrics entry,
- do not fabricate lyrics.

### 20.2 Alignment uncertainty

Low-confidence lyric timing should be marked for review rather than treated as precise.

### 20.3 Semantic uncertainty

The Song Understanding model must be allowed to say a theme or metaphor is uncertain. The UI should surface uncertainty rather than hide it.

### 20.4 Generation failure

Continue using EZAv2's fail-fast/resumable generation behavior where possible:
- preserve successful assets,
- retry only failed/missing assets,
- expose the real provider error,
- do not collapse failures into vague “missing takes” errors.

## 21. Professional Quality Bar

The Director is considered successful only if it can produce plans that demonstrate:

- clear relationship to the actual song meaning,
- coherent beginning/middle/end visual progression,
- intentional performance/narrative balance,
- recurring motifs/worlds,
- controlled scene continuity,
- purposeful lyric-specific moments,
- appropriate musical pacing,
- usable coverage rather than isolated glamour frames,
- strong hero moments,
- evolving repeated sections,
- rationale-backed scene and shot choices,
- editable treatment and plan before generation,
- traceable prompt/reference inheritance,
- versioned takes and edits.

A plan that merely maps high energy to “Hero Performance” and low energy to “Story/B-roll” does not meet this quality bar. A plan that merely rotates through camera/framing presets also does not meet this bar.

## 22. Migration From Current Director

The current heuristic `createDirectorPlan(AudioAnalysis, vision, bible)` should no longer be the professional planning entry point.

Its audio functions may still be reused for:
- shot-duration targets,
- cut snapping,
- energy contours,
- beat/downbeat alignment,
- section timing.

Its generic story-role/idea generation and camera/framing cycling must not be used as semantic song interpretation or professional shot design.

Existing projects created under the old Director should remain openable. They can be labeled `Legacy Director Plan` and optionally upgraded by running the new Lyrics -> Understanding -> Treatment pipeline.

## 23. Security / Configuration

- Provider credentials remain server-side environment variables.
- Credentials are never stored in project snapshots.
- Lyrics and song-understanding artifacts are project data and follow the same persistence boundaries as other project metadata.
- External transcription calls should be server-side, not browser-direct.

## 24. Testing Strategy

Implementation must include automated coverage for at least:

### Contracts
- lyrics required before vocal-song semantic planning,
- Instrumental Mode explicit bypass,
- treatment locked until understanding approval,
- plan locked until treatment approval,
- Global Negative Prompt mandatory before image generation,
- unapproved images cannot generate video,
- unapproved takes cannot enter edit,
- unapproved edit cannot export final.

### Lyric flow
- transcription draft persistence,
- official lyric replacement/alignment,
- corrected lyric versioning,
- low-confidence timing handling.

### Director behavior
- key lyric moments propagate into treatment/shot metadata,
- repeated chorus scenes evolve instead of randomizing,
- shot budget remains controlled,
- scene inheritance reaches prompts,
- every scene/shot has a rationale,
- shot decisions do not depend on sequential camera/framing cycling,
- raw provider prompts remain derived outputs.

### Generation
- correct reference inheritance,
- Global Negative Prompt merge/de-duplication,
- selective shot regeneration,
- hero multi-take behavior,
- continuity report persistence.

### Editing
- immutable Edit V1/V2 versioning,
- revision instructions affect only the intended timeline decisions,
- original song remains the final audio source.

### Render deployment
- full `pnpm build` and strict TypeScript build must pass before deployment.
- Render should not replace the live service on a failed build.

## 25. Rollout Strategy

Implement in controlled phases rather than rewriting EZAv2 at once:

Phase A — Lyrics + Song Understanding
- transcription provider adapter,
- official lyrics/correction UI,
- semantic Song Understanding,
- mandatory approval gate.

Phase B — Professional Treatment + Planning
- Hybrid Director treatment,
- project-specific Production Bible,
- scene-first planning,
- coverage/shot budget,
- rationale-driven shot design,
- plan approval.

Phase C — Generation QC
- automatic reference resolution,
- image-first storyboard,
- continuity evaluator,
- hero takes,
- selective regeneration/versioning.

Phase D — Professional Editing
- Edit Director,
- Edit V1/V2 revisions,
- source take selection,
- final approval/export.

Each phase must preserve the existing Advanced Editor and Agnes provider stack.

## 26. Final Approved Product Flow

`Upload Song`

-> `Analyze Music`

-> `Transcribe Lyrics`

-> `Correct / Supply Official Lyrics`

-> `Approve Lyrics`

-> `Generate Song Understanding`

-> `Approve Song Understanding`

-> `Generate Hybrid Creative Treatment`

-> `Approve Treatment`

-> `Generate Production Bible + Scenes + Coverage Shot Plan`

-> `Approve Production Bible + Storyboard Plan`

-> `Generate Storyboard Images`

-> `Approve / Regenerate Images`

-> `Generate Video Takes`

-> `Approve / Select Takes`

-> `Create BeatSync Edit V1`

-> `Revise to V2/V3 as needed`

-> `Approve Edit`

-> `Final Export`

This pipeline is the source of truth for the Professional Director implementation.