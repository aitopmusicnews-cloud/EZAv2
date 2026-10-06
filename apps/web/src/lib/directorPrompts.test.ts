import { describe, expect, it } from "vitest";
import type { DirectorShot, ProductionBible, ReferenceAsset } from "@mvs/shared";
import { compileDirectorImageRequest, compileDirectorVideoRequest } from "./directorPrompts.js";

const shot: DirectorShot = {
  id: "shot-1",
  clipId: "clip-1",
  start: 10,
  end: 15,
  sectionLabel: "verse 2",
  role: "Featured Artist Performance with crowd",
  idea: "Featured Artist performs in the center of a packed crowd while the audience reacts around them.",
  camera: "slow orbit",
  framing: "medium",
  mood: "electric",
  location: "underground performance hall",
  energy: 0.8,
  performerArtist: "Featured Artist",
  characterIds: ["feature"],
  assetIds: [],
  hero: true,
  imageStatus: "idle",
  imageApproved: false,
  videoApproved: false,
};

const bible: ProductionBible = {
  characterProfile: "Two distinct artists",
  negativePrompt: "identity drift, duplicate subjects",
  characterLocks: [
    { id: "feature", slot: 2, name: "Featured Artist", referenceAssetId: "feature-ref", locked: true },
  ],
  assetLocks: [],
};

const references: ReferenceAsset[] = [
  { id: "feature-ref", url: "https://example.com/feature.jpg", name: "Featured Artist", role: "character", locked: true },
];

describe("Director crowd and vocalist prompts", () => {
  it("keeps the timed vocalist tied to the assigned Character Lock", () => {
    const request = compileDirectorImageRequest(shot, bible, references);
    expect(request.promptText).toContain("Timed vocalist / performer: Featured Artist");
    expect(request.promptText).toContain("Character Lock assigned to this artist");
  });

  it("allows distinct crowd extras without cloning the locked artist", () => {
    const image = compileDirectorImageRequest(shot, bible, references);
    expect(image.promptText).toContain("A background crowd is allowed");
    expect(image.promptText).toContain("DIFFERENT identity");
    expect(image.promptText).toContain("cloned crowd");
    expect(image.promptText).toContain("locked artist face copied into crowd");

    const video = compileDirectorVideoRequest(shot, bible, references);
    expect(video.promptText).toContain("A background crowd is allowed");
    expect(video.negativePrompt).toContain("cloned crowd");
    expect(video.negativePrompt).toContain("repeated background face");
    expect(video.negativePrompt).toContain("locked artist face copied into crowd");
  });
});
