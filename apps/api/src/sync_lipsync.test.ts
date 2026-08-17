import { describe, expect, it, vi } from "vitest";
import { createSyncLipSync, getSyncLipSync } from "./sync_lipsync.js";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Sync Labs lip-sync adapter", () => {
  it("creates sync-3 with one video and one audio URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "job-123", status: "PENDING" }, 201));
    await expect(createSyncLipSync(
      { videoUrl: "https://cdn.example.com/clip.mp4", audioUrl: "https://cdn.example.com/slice.mp3" },
      "sync-secret",
      fetchMock as typeof fetch,
    )).resolves.toEqual({ id: "job-123" });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init!.body));
    expect(body).toEqual({
      model: "sync-3",
      input: [
        { type: "video", url: "https://cdn.example.com/clip.mp4" },
        { type: "audio", url: "https://cdn.example.com/slice.mp3" },
      ],
    });
    expect(new Headers(init!.headers).get("x-api-key")).toBe("sync-secret");
  });

  it("maps completed and rejected states", async () => {
    await expect(getSyncLipSync("job-123", "secret", async () =>
      jsonResponse({ status: "COMPLETED", outputUrl: "https://cdn.example.com/out.mp4", progress_percent: 100 })
    )).resolves.toMatchObject({ status: "completed", outputUrl: "https://cdn.example.com/out.mp4", progress: 100 });

    await expect(getSyncLipSync("job-123", "secret", async () =>
      jsonResponse({ status: "REJECTED", error: "no face", errorCode: "face_not_detected" })
    )).resolves.toMatchObject({ status: "failed", error: expect.stringMatching(/no face/) });
  });

  it("retries transient status GET but never duplicates create POST", async () => {
    const sleep = vi.fn(async () => {});
    const statusFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: "temporary" }, 503))
      .mockResolvedValueOnce(jsonResponse({ status: "PENDING", progress_percent: 20 }));

    await expect(getSyncLipSync("job-123", "secret", statusFetch as typeof fetch, sleep))
      .resolves.toMatchObject({ status: "waiting", progress: 20 });
    expect(statusFetch).toHaveBeenCalledTimes(2);
  });
});
