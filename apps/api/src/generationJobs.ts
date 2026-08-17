export type GenerationTaskSource = "agnes";

export interface JobRecord {
  status: "pending" | "running" | "completed" | "failed";
  video_url?: string;
  image_url?: string;
  error?: string;
  prompt: string;
  createdAt: number;
  updatedAt: number;
  provider?: GenerationTaskSource;
  providerState?: unknown;
}

export type GenerationTask = { id: string };
export type TaskIdPayload = { source: GenerationTaskSource; id: string };

function jobKey(jobId: string): string {
  return `jobs/${jobId}.json`;
}

export async function writeJobToDisk(jobId: string, record: JobRecord): Promise<void> {
  const { storage } = await import("./storage.js");
  await storage.saveJson(jobKey(jobId), record);
}

export async function readJobFromDisk(jobId: string): Promise<JobRecord | null> {
  try {
    const { storage } = await import("./storage.js");
    return await storage.loadJson<JobRecord>(jobKey(jobId));
  } catch (error) {
    console.error(`[Job Store] Failed to read ${jobId}:`, error);
    return null;
  }
}

export function encodeTaskId(payload: TaskIdPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeTaskId(encoded: string): TaskIdPayload {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (parsed?.source === "agnes" && typeof parsed.id === "string" && parsed.id.trim()) {
      return { source: "agnes", id: parsed.id };
    }
  } catch {
    // Fall through to the stable public validation error below.
  }
  throw new Error("Invalid generation task id.");
}
