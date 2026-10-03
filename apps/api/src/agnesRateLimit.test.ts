import { describe, expect, it, vi } from "vitest";
import { createAgnesVideo, getAgnesResultOnce } from "./agnes_http.js";
const input = { prompt: "A natural moving scene", width: 1280, height: 720, numFrames: 81 };
describe("Agnes temporary limits", () => {
  it("waits a full minute when Retry-After is missing instead of treating null as zero", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429 })).mockResolvedValueOnce(new Response(JSON.stringify({ video_id: "video-123" })));
    const sleep = vi.fn(async () => {});
    await expect(createAgnesVideo(input, "test", fetchImpl, sleep)).resolves.toEqual({ videoId: "video-123", taskId: null });
    expect(sleep).toHaveBeenCalledWith(61_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("honors longer Retry-After values", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '120' } })).mockResolvedValueOnce(new Response(JSON.stringify({ video_id: "video-123" })));
    const sleep = vi.fn(async () => {});
    await createAgnesVideo(input, "test", fetchImpl, sleep);
    expect(sleep).toHaveBeenCalledWith(120_000);
  });
  it.each([429, 503])("preserves the existing job when status polling returns %s", async (status) => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status }));
    expect(await getAgnesResultOnce({ videoId: "video-123", taskId: "task-123" }, "test", fetchImpl)).toEqual({ kind: "waiting", status: "in_progress" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
