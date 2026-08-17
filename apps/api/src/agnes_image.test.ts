import { describe, expect, it, vi } from "vitest";
import { parseAgnesImageResult } from "./agnes_core.js";
import { createAgnesImage, createAgnesVideo } from "./agnes_http.js";

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("Agnes image integration", () => {
  it("parses URL and base64 image responses", () => {
    expect(parseAgnesImageResult({ data: [{ url: "https://cdn.example.com/generated.png" }] }))
      .toEqual({ kind: "url", url: "https://cdn.example.com/generated.png" });
    expect(parseAgnesImageResult({ data: [{ b64_json: "aGVsbG8=" }] }))
      .toEqual({ kind: "base64", data: "aGVsbG8=" });
  });

  it("retries an explicit 503 then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "busy" } }, 503))
      .mockResolvedValueOnce(jsonResponse({ data: [{ url: "https://cdn.example.com/image.png" }] }));

    const result = await createAgnesImage(
      { prompt: "cinematic singer", size: "1536x864" },
      "secret",
      fetchMock as typeof fetch,
      sleep,
    );

    expect(result).toEqual({ kind: "url", url: "https://cdn.example.com/image.png" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchMock.mock.calls[1]![1]!.body));
    expect(request).toMatchObject({
      model: "agnes-image-2.1-flash",
      prompt: "cinematic singer",
      size: "1536x864",
    });
  });

  it("applies the same 503 retry to video creation", async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: "busy" }, 503))
      .mockResolvedValueOnce(jsonResponse({ video_id: "video-1" }));

    await expect(createAgnesVideo(
      { prompt: "scene", width: 1152, height: 768, numFrames: 121 },
      "secret",
      fetchMock as typeof fetch,
      sleep,
    )).resolves.toEqual({ videoId: "video-1", taskId: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a short safe provider error after retries are exhausted", async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "system busy" } }, 503));
    await expect(createAgnesImage(
      { prompt: "scene", size: "1024x1024" },
      "secret",
      fetchMock as typeof fetch,
      sleep,
    )).rejects.toThrow(/status 503: system busy/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
