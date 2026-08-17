import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const root = new URL("../../../../", import.meta.url);

async function read(path: string) {
  return readFile(new URL(path, root), "utf8");
}

describe("text-to-image and manual lip-sync contracts", () => {
  it("adds provider contracts without changing Clip.source semantics", async () => {
    const shared = await read("packages/shared/src/index.ts");
    expect(shared).toMatch(/AGNES_IMAGE_MODEL\s*=\s*"agnes-image-2\.1-flash"/);
    expect(shared).toMatch(/SYNC_LIPSYNC_MODEL\s*=\s*"sync-3"/);
    expect(shared).toMatch(/TextToImageRequest/);
    expect(shared).toMatch(/LipSyncRequest/);
    expect(shared).toMatch(/lipSyncTaskId/);
    expect(shared).toMatch(/lipSyncStatus/);
    expect(shared).toMatch(/lipSyncSourceVideoUrl/);
    expect(shared).toMatch(/lipSyncModel/);
    expect(shared).not.toMatch(/z\.enum\(\[[^\]]*"textToImage"[^\]]*\]\)/s);
    expect(shared).not.toMatch(/z\.enum\(\[[^\]]*"lipSync"[^\]]*\]\)/s);
  });

  it("wires text-to-image through the server and browser API", async () => {
    const server = await read("apps/api/src/server.ts");
    const api = await read("apps/web/src/lib/api.ts");
    expect(server).toMatch(/\/api\/generate\/text-to-image/);
    expect(api).toMatch(/generateTextToImage/);
  });

  it("exposes text-to-image as a UI-only mode with explicit handoff actions", async () => {
    const sidebar = await read("apps/web/src/components/Sidebar.tsx");
    expect(sidebar).toMatch(/Text → Image/);
    expect(sidebar).toMatch(/generateTextToImage/);
    expect(sidebar).toMatch(/Add to Lookbook/);
    expect(sidebar).toMatch(/Use as Start Image/);
    expect(sidebar).not.toMatch(/enqueueGeneration\([^)]*textToImage/s);
  });

  it("routes manual lip-sync through the selected song slice", async () => {
    const server = await read("apps/api/src/server.ts");
    const api = await read("apps/web/src/lib/api.ts");
    expect(server).toMatch(/\/api\/generate\/lipsync/);
    expect(server).toMatch(/sliceAudio\(body\.audioUrl, body\.start, body\.end\)/);
    expect(server).toMatch(/\/api\/lipsync\/tasks\/:id/);
    expect(api).toMatch(/startLipSync/);
    expect(api).toMatch(/pollLipSyncTask/);
  });

  it("starts lip-sync only from the manual button and resumes existing tasks separately", async () => {
    const sidebar = await read("apps/web/src/components/Sidebar.tsx");
    const editor = await read("apps/web/src/routes/Editor.tsx");
    const controller = await read("apps/web/src/lib/lipsync.ts").catch(() => "");
    expect(sidebar).toMatch(/Lip-sync to song segment/);
    expect(sidebar).toMatch(/applyLipSyncToClip/);
    expect(controller).toMatch(/startLipSync/);
    expect(controller).toMatch(/pollLipSyncTask/);
    expect(controller).toMatch(/lipSyncSourceVideoUrl/);
    expect(editor).toMatch(/resumeInflightLipSyncJobs/);
    expect(editor).not.toMatch(/applyLipSyncToClip\(/);
  });
});
