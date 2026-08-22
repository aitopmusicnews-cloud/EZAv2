# Agnes Production Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured production controls so EZAv2 can preserve character/vehicle references, spatial locks, negative prompts, and multi-reference Agnes image generation across scenes.

**Architecture:** Extend shared schemas first, then add a pure prompt compiler/validator, expand Agnes image/video adapters, carry the fields through scheduler/store persistence, and expose them in Sidebar with a request inspector. Existing text-only prompts and historical projects remain valid.

**Tech Stack:** TypeScript, React, Zustand, Zod, Fastify, Vitest, Agnes Image 2.1 / Agnes Video V2.0 APIs.

**Spec:** `docs/superpowers/specs/2026-08-22-agnes-production-controls-design.md`

## Global Constraints

- Agnes remains the only active AI video provider.
- Existing project snapshots must continue to parse and load.
- Existing `characterImageUrl` and `lookbook` workflows remain usable.
- Existing text-only image/video generation remains valid.
- Hard spatial constraints compile before creative scene prose.
- Character and vehicle references are semantic assets, not anonymous lookbook URLs.
- Video negative prompts are sent to Agnes as `negative_prompt`.
- Text-to-image supports prompt-only, single-reference, and multi-reference compose modes.

---

### Task 1: Shared production-control schemas

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/production-controls.test.ts`

**Interfaces:**
- Produces: `ReferenceAsset`, `ProductionBible`, `SpatialLock`, expanded `Clip`, `TextToImageRequest`, video request schemas.

- [ ] Write failing tests proving historical snapshots still parse and new production-control fields validate.
- [ ] Run `pnpm test packages/shared/src/production-controls.test.ts` and verify RED.
- [ ] Add minimal Zod schemas/types and optional fields.
- [ ] Re-run the focused test and verify GREEN.
- [ ] Commit `feat: add production control schemas`.

### Task 2: Prompt compiler and spatial validator

**Files:**
- Create: `apps/web/src/lib/promptCompiler.ts`
- Test: `apps/web/src/lib/promptCompiler.test.ts`

**Interfaces:**
- Produces: `compileImagePrompt`, `compileVideoPrompt`, `compileNegativePrompt`, `validateSpatialLock`.
- Consumes: shared `ProductionBible`, `ReferenceAsset`, `SpatialLock`, `Clip`.

- [ ] Write failing tests for ordering: spatial constraints before identity/vehicle before scene/style.
- [ ] Write failing tests for left-hand-drive mirror wording and contradictions.
- [ ] Run focused tests and verify RED.
- [ ] Implement minimal pure compiler/validator.
- [ ] Re-run focused tests and verify GREEN.
- [ ] Commit `feat: compile structured production prompts`.

### Task 3: Agnes request forwarding

**Files:**
- Modify: `apps/api/src/agnes_http.ts`
- Modify: `apps/api/src/agnes_image.ts`
- Modify: `apps/api/src/agnesVideo.ts`
- Test: `apps/api/src/agnes_image.test.ts`
- Create: `apps/api/src/agnes_production_controls.test.ts`

**Interfaces:**
- Image input: `{ prompt, size, mode, referenceImages }`.
- Video input adds `negativePrompt` and forwards `negative_prompt`.

- [ ] Write failing adapter tests asserting compose/reference serialization and video `negative_prompt` forwarding.
- [ ] Run focused API tests and verify RED.
- [ ] Implement request serialization without changing existing response handling.
- [ ] Re-run API tests and verify GREEN.
- [ ] Commit `feat: forward Agnes production controls`.

### Task 4: Store and scheduler propagation

**Files:**
- Modify: `apps/web/src/lib/store.ts`
- Modify: `apps/web/src/lib/scheduler.ts`
- Test: `apps/web/src/lib/store.test.ts`
- Create: `apps/web/src/lib/scheduler-production-controls.test.ts`

**Interfaces:**
- Project state adds `productionBible` and `referenceAssets`.
- Job input carries `negativePrompt`, `referenceImages`, and compiled prompt metadata.

- [ ] Write failing persistence and scheduler tests.
- [ ] Run focused tests and verify RED.
- [ ] Implement optional persisted state with historical fallback.
- [ ] Carry compiled prompt and negative prompt through generation requests.
- [ ] Re-run focused tests and verify GREEN.
- [ ] Commit `feat: persist production generation context`.

### Task 5: Sidebar production controls and request inspector

**Files:**
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/styles/generation-tools.css`
- Modify: `apps/web/src/components/Sidebar.contract.test.ts`

**Interfaces:**
- UI exposes reference roles, character/vehicle selection, spatial lock presets, scene negative prompt, validation warnings, and compiled request inspector.

- [ ] Extend contract tests first for new labeled controls and inspector.
- [ ] Verify RED in CI/focused tests.
- [ ] Implement compact production controls that default from Production Bible.
- [ ] Use compiler output when generating instead of raw prompt alone.
- [ ] Add inspector showing mode, references, compiled prompt, negative prompt, size/duration.
- [ ] Verify GREEN.
- [ ] Commit `feat: add Agnes production control UI`.

### Task 6: CI and regression verification

**Files:**
- Modify: `.github/workflows/feature-ci.yml`
- Modify: `README.md`

**Interfaces:**
- Feature branch CI runs tests, soundtrack regression, typecheck, and build.

- [ ] Update CI trigger to include `feat/agnes-production-controls`.
- [ ] Document production controls and reference requirements.
- [ ] Push branch and verify GitHub Actions passes: `pnpm test`, soundtrack regression, `pnpm typecheck`, `pnpm build`.
- [ ] If CI fails, fix failures test-first and rerun.
- [ ] Commit `docs: document Agnes production controls`.

### Task 7: Final verification and review

**Files:**
- Review all changed files.

- [ ] Compare branch against `main` and inspect all patches for scope creep.
- [ ] Confirm no production code path drops `negativePrompt` or reference arrays.
- [ ] Confirm historical project parsing remains covered.
- [ ] Confirm CI is fully green.
- [ ] Open a pull request into `main` with summary, test evidence, and known limitation that model compliance cannot be guaranteed.
