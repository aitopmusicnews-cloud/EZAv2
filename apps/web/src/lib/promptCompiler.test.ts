import { describe, expect, it } from "vitest";
import type { ProductionBible, ReferenceAsset, SpatialLock } from "@mvs/shared";
import {
  compileImagePrompt,
  compileNegativePrompt,
  compileVideoPrompt,
  validateSpatialLock,
} from "./promptCompiler.js";

const spatial: SpatialLock = {
  trafficSystem: "US_RIGHT_HAND",
  driveSide: "LEFT_HAND_DRIVE",
  driverSeat: "FRONT_LEFT",
  passengerSeat: "FRONT_RIGHT",
  cameraPosition: "FRONT_PASSENGER_INTERIOR",
  cameraDirection: "TOWARD_DRIVER_AND_CENTER_MIRROR",
  vehicleDirection: "FORWARD",
  competitorPosition: "BEHIND",
  competitorDirection: "SAME_DIRECTION",
  rearviewMirrorShows: "ROAD_BEHIND_AND_COMPETITORS",
  windshieldShows: "OPEN_ROAD_AHEAD",
  allowOncomingTraffic: false,
};

const bible: ProductionBible = {
  characterProfile: "Same 28-year-old African American woman with deep brown skin and long black locs.",
  vehicleProfile: "Same glossy black performance coupe with orange accents.",
  stylePrompt: "Premium cinematic hip-hop music-video realism, black/orange/gold palette.",
  negativePrompt: "duplicate protagonist, inconsistent face",
  characterReferenceAssetIds: ["char-1"],
  vehicleReferenceAssetIds: ["car-1"],
};

const references: ReferenceAsset[] = [
  { id: "char-1", url: "https://cdn.example.com/char.png", role: "character", locked: true },
  { id: "car-1", url: "https://cdn.example.com/car.png", role: "vehicle", locked: true },
];

describe("prompt compiler", () => {
  it("puts hard spatial rules before identity, scene, and style prose", () => {
    const prompt = compileImagePrompt({
      scenePrompt: "She checks the center rearview mirror while driving through the city.",
      productionBible: bible,
      spatialLock: spatial,
      referenceAssets: references,
    });

    expect(prompt.indexOf("[HARD SPATIAL CONSTRAINTS]")).toBeLessThan(prompt.indexOf("[CHARACTER LOCK]"));
    expect(prompt.indexOf("[CHARACTER LOCK]")).toBeLessThan(prompt.indexOf("[VEHICLE LOCK]"));
    expect(prompt.indexOf("[VEHICLE LOCK]")).toBeLessThan(prompt.indexOf("[SCENE]"));
    expect(prompt.indexOf("[SCENE]")).toBeLessThan(prompt.indexOf("[STYLE]"));
  });

  it("embeds image negatives into an AVOID section because Agnes Image has no separate negative field", () => {
    const prompt = compileImagePrompt({
      scenePrompt: "Mirror shot",
      productionBible: bible,
      spatialLock: spatial,
      referenceAssets: references,
      negativePrompt: "right-hand-drive car",
    });
    expect(prompt).toContain("[AVOID]");
    expect(prompt).toContain("right-hand-drive car");
    expect(prompt).toContain("woman in passenger seat");
  });

  it("spells out left-hand-drive, passenger-camera, mirror, and rival direction logic", () => {
    const prompt = compileVideoPrompt({
      scenePrompt: "She glances at the mirror and smirks.",
      productionBible: bible,
      spatialLock: spatial,
      referenceAssets: references,
    });

    expect(prompt).toContain("steering wheel is on the LEFT");
    expect(prompt).toContain("LEFT FRONT DRIVER'S SEAT");
    expect(prompt).toContain("RIGHT FRONT PASSENGER");
    expect(prompt).toContain("camera is positioned inside the right front passenger area");
    expect(prompt).toContain("rearview mirror reflects the roadway BEHIND");
    expect(prompt).toContain("competitors are BEHIND the protagonist");
    expect(prompt).toContain("travel in the SAME direction");
    expect(prompt).toContain("No oncoming traffic");
    expect(prompt).toContain("front windshield shows open road ahead");
  });

  it("combines global, scene, and spatial negatives without duplicates", () => {
    const negative = compileNegativePrompt({
      productionBible: bible,
      spatialLock: spatial,
      negativePrompt: "right-hand-drive car, duplicate protagonist",
    });

    expect(negative).toContain("right-hand-drive car");
    expect(negative).toContain("woman in passenger seat");
    expect(negative).toContain("oncoming competitors");
    expect(negative.match(/duplicate protagonist/g)?.length).toBe(1);
  });

  it("flags obvious spatial contradictions before generation", () => {
    expect(validateSpatialLock({
      driveSide: "LEFT_HAND_DRIVE",
      driverSeat: "FRONT_RIGHT",
      competitorDirection: "ONCOMING",
      allowOncomingTraffic: false,
    })).toEqual(expect.arrayContaining([
      expect.stringMatching(/left-hand-drive/i),
      expect.stringMatching(/oncoming traffic/i),
    ]));
  });
});
