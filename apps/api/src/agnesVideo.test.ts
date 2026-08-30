import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAgnesVideo: vi.fn(),
  getAgnesResultOnce: vi.fn(),
  writeJobToDisk: vi.fn(async () => {}),
  readJobFromDisk: vi.fn(),
  encodeTaskId: vi.fn(() => "encoded-task"),
}));

vi.mock("./config.js", () => ({ config: { AGNES_API_KEY: "secret" } }));
vi.mock("./agnes_http.js", () => ({
  createAgnesVideo: mocks.createAgnesVideo,
  getAgnesResultOnce: mocks.getAgnesResultOnce,
}));
vi.mock("./generationJobs.js", () => ({
  writeJobToDisk: mocks.writeJobToDisk,
  readJobFromDisk: mocks.readJobFromDisk,
  encodeTaskId: mocks.encodeTaskId,
}));
vi.mock("./storage.js", () => ({
  providerUrl: vi.fn(async (url: string) => url),
  storage: { saveUpload: vi.fn() },
}));
vi.mock("./net.js", () => ({
  assertSafeHost: vi.fn(async () => {}),
  readCappedBody: vi.fn(),
}));
vi.mock("./ffmpeg.js", () => ({ normalizeGeneratedVisual: vi.fn() }));
vi.mock("./frames.js", () => ({ extractLastFrame: vi.fn() }));
vi.mock("./video_stitch.js", () => ({ stitchVideoSegments: vi.fn() }));

import { startAgnesVideo } from "./agnesVideo.js";

describe("Agnes video job startup", () => {
  it("returns a task id without waiting for Agnes to accept the create request", async () => {
    let releaseProvider!: (value: { videoId: string; taskId: null }) => void;
    mocks.createAgnesVideo.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseProvider = resolve;
      }),
    );

    const startPromise = startAgnesVideo(
      { promptText: "cinematic scene", duration: 5, aspectRatio: "16:9" } as any,
      "textToVideo",
    );
    const blocked = Symbol("blocked");
    const firstResult = await Promise.race([
      startPromise,
      new Promise<typeof blocked>((resolve) => setTimeout(() => resolve(blocked), 100)),
    ]);

    expect(firstResult).toEqual({ id: "encoded-task" });
    expect(mocks.createAgnesVideo).toHaveBeenCalledTimes(1);
    expect(mocks.writeJobToDisk).toHaveBeenCalledWith(
      expect.stringMatching(/^agnes_/),
      expect.objectContaining({ status: "pending", provider: "agnes" }),
    );

    releaseProvider({ videoId: "video-1", taskId: null });
    await startPromise;
    await vi.waitFor(() => {
      expect(mocks.writeJobToDisk).toHaveBeenCalledWith(
        expect.stringMatching(/^agnes_/),
        expect.objectContaining({ status: "running", provider: "agnes" }),
      );
    });
  });
});
