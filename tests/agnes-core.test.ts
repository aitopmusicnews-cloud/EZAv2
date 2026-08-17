import {
  AGNES_MAX_FRAMES,
  AGNES_FRAME_RATE,
  frameCountForDuration,
  splitTimelineDuration,
  parseAgnesCreateIds,
  validCompletedMetadataUrl,
  isAgnesWaitStatus,
} from "../apps/api/src/agnes_core.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

equal(AGNES_FRAME_RATE, 24, "fps");
equal(AGNES_MAX_FRAMES, 441, "max frames");
equal(frameCountForDuration(5), 121, "5s frame count");
equal(frameCountForDuration(18), 433, "18s frame count");
assert(frameCountForDuration(18.375) <= 441, "max duration must fit 441 frames");
const segments = splitTimelineDuration(40);
assert(segments.length === 3, "40s should split into 3 provider segments");
const sum = segments.reduce((n, s) => n + s.targetDuration, 0);
assert(Math.abs(sum - 40) < 1e-9, "split durations must add back to logical duration");
assert(segments.every((s) => s.numFrames <= 441 && s.numFrames % 8 === 1), "every segment must obey Agnes frame rule");
const ids = parseAgnesCreateIds({ video_id: "video_1", task_id: "task_1" });
equal(ids.videoId, "video_1", "video id");
equal(ids.taskId, "task_1", "task id");
equal(validCompletedMetadataUrl({ metadata: { url: "https://example.com/out.mp4" } }), "https://example.com/out.mp4", "completed url");
equal(validCompletedMetadataUrl({ metadata: { url: "http://example.com/out.mp4" } }), null, "reject http result");
assert(isAgnesWaitStatus("pending") && isAgnesWaitStatus("queued") && isAgnesWaitStatus("in_progress"), "wait states");
console.log("agnes core tests passed");
