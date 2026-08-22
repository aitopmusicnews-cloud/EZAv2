import { describe, expect, it } from "vitest";
import {
  Clip,
  ImageToVideoRequest,
  KeyframeToVideoRequest,
  TextToImageRequest,
  TextToVideoRequest,
} from "./index.js";

describe("production control schemas", () => {
  it("preserves image compose mode and semantic references", () => {
    const parsed = TextToImageRequest.parse({
      promptText: "driver in a black coupe",
      size: "1536x864",
      mode: "compose",
      referenceImages: [
        { id: "char-1", url: "https://cdn.example.com/character.png", role: "character", locked: true },
        { id: "car-1", url: "https://cdn.example.com/car.png", role: "vehicle", locked: true },
      ],
    });

    expect(parsed).toMatchObject({
      mode: "compose",
      referenceImages: [
        { id: "char-1", role: "character", locked: true },
        { id: "car-1", role: "vehicle", locked: true },
      ],
    });
  });

  it("preserves video negative prompts across all Agnes video request modes", () => {
    const negativePrompt = "right-hand-drive car, duplicate protagonist, oncoming rivals";

    expect(TextToVideoRequest.parse({ promptText: "scene", duration: 8, negativePrompt }).negativePrompt)
      .toBe(negativePrompt);
    expect(ImageToVideoRequest.parse({
      promptImage: "https://cdn.example.com/start.png",
      promptText: "motion",
      duration: 8,
      negativePrompt,
    }).negativePrompt).toBe(negativePrompt);
    expect(KeyframeToVideoRequest.parse({
      promptImage: "https://cdn.example.com/start.png",
      promptImageEnd: "https://cdn.example.com/end.png",
      promptText: "transition",
      duration: 8,
      negativePrompt,
    }).negativePrompt).toBe(negativePrompt);
  });

  it("preserves per-clip spatial locks, semantic references, and negatives", () => {
    const parsed = Clip.parse({
      id: "clip-1",
      start: 0,
      end: 8,
      source: "imageToVideo",
      status: "empty",
      negativePrompt: "right-hand-drive car",
      referenceAssetIds: ["char-1", "car-1"],
      spatialLock: {
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
      },
    });

    expect(parsed).toMatchObject({
      negativePrompt: "right-hand-drive car",
      referenceAssetIds: ["char-1", "car-1"],
      spatialLock: {
        driverSeat: "FRONT_LEFT",
        cameraPosition: "FRONT_PASSENGER_INTERIOR",
        competitorPosition: "BEHIND",
        allowOncomingTraffic: false,
      },
    });
  });
});
