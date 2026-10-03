// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "node:https";
import { requestPage, publicLookup } from "./promoWebsite.js";
vi.mock("node:https", () => { const request = vi.fn(); return { request, default: { request } }; });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

function transport(headers: Record<string, string>, body?: Buffer) {
  const req = new EventEmitter() as any;
  const response = Object.assign(new PassThrough(), { statusCode: 200, headers });
  response.on("close", () => req.emit("close"));
  req.end = () => queueMicrotask(() => { req.emit("response", response); if (body) response.end(body); });
  req.destroy = (error: Error) => { req.emit("error", error); req.emit("close"); return req; };
  vi.mocked(request).mockReturnValue(req);
  return req;
}
describe("bounded website transport", () => {
  it("pins DNS and limits declared response size", async () => {
    transport({ "content-type": "text/html", "content-length": "3000000" });
    await expect(requestPage(new URL("https://example.com"))).rejects.toThrow(/too large/);
    expect(request).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ lookup: publicLookup, agent: false }));
  });
  it("limits streamed responses without a declared length", async () => {
    transport({ "content-type": "text/html" }, Buffer.alloc(2 * 1024 * 1024 + 1));
    await expect(requestPage(new URL("https://example.com"))).rejects.toThrow(/too large/);
  });
  it("limits decompressed responses", async () => {
    transport({ "content-type": "text/html", "content-encoding": "gzip" }, gzipSync(Buffer.alloc(3 * 1024 * 1024)));
    await expect(requestPage(new URL("https://example.com"))).rejects.toThrow(/Could not read/);
  });
  it("terminates a stalled response within the time bound", async () => {
    vi.useFakeTimers();
    transport({ "content-type": "text/html" });
    const result = expect(requestPage(new URL("https://example.com"))).rejects.toThrow(/too long/);
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
  });
});
