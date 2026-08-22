import { beforeEach, describe, expect, it, vi } from "vitest";

const startImageToVideo = vi.fn(async () => ({ id: "task-1" }));
const pollTask = vi.fn(async () => ({ status: "SUCCEEDED", output: ["https://cdn.example.com/result.mp4"] }));
const saveClipToServer = vi.fn(async (input: any) => ({ ...input, savedAt: new Date().toISOString() }));

vi.mock("./api.js", () => ({
  startImageToVideo,
  startKeyframeToVideo: vi.fn(async () => ({ id: "task-key" })),
  startTextToVideo: vi.fn(async () => ({ id: "task-text" })),
  pollTask,
  saveClipToServer,
  ApiError: class ApiError extends Error {
    rateLimited = false;
  },
}));

vi.mock("./toast.js", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

import { useStore } from "./store.js";
import { enqueueGeneration } from "./scheduler.js";

describe("scheduler production controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      clips: [{
        id: "clip-1",
        start: 0,
        end: 8,
        source: "imageToVideo",
        status: "empty",
      }],
      jobs: [],
      selectedClipId: "clip-1",
    });
  });

  it("preserves the compiled prompt and negative prompt in the Agnes request", async () => {
    enqueueGeneration({
      clipId: "clip-1",
      source: "imageToVideo",
      seedImageUrl: "https://cdn.example.com/start.png",
      prompt: "[HARD SPATIAL CONSTRAINTS] left-hand-drive\n\n[SCENE] mirror shot",
      negativePrompt: "right-hand-drive car, oncoming competitors",
      duration: 8,
      sectionLabel: "verse",
      energy: 0.8,
      model: "agnes-video-v2.0",
    } as any);

    await vi.waitFor(() => expect(startImageToVideo).toHaveBeenCalledTimes(1));
    expect(startImageToVideo.mock.calls[0]![0]).toMatchObject({
      promptText: "[HARD SPATIAL CONSTRAINTS] left-hand-drive\n\n[SCENE] mirror shot",
      negativePrompt: "right-hand-drive car, oncoming competitors",
      promptImage: "https://cdn.example.com/start.png",
      duration: 8,
    });

    await vi.waitFor(() => expect(useStore.getState().clips[0]?.status).toBe("ready"));
    expect(useStore.getState().clips[0]).toMatchObject({
      compiledPrompt: "[HARD SPATIAL CONSTRAINTS] left-hand-drive\n\n[SCENE] mirror shot",
      compiledNegativePrompt: "right-hand-drive car, oncoming competitors",
    });
  });
});
