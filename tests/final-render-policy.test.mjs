import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const render = await readFile('apps/api/src/render.ts', 'utf8');

assert.match(render, /source === "textToVideo"/);
assert.match(render, /source === "imageToVideo"/);
assert.match(render, /source === "keyframeToVideo"/);
assert.match(
  render,
  /for \(let i = 0; i < slices\.length; i\+\+\)/,
  'final render must normalize timeline slices sequentially',
);
assert.doesNotMatch(
  render,
  /sourceDurations\s*=\s*await Promise\.all/,
  'final render must not probe/process every clip concurrently',
);
assert.match(
  render,
  /"-f", "concat"/,
  'normalized local slices must be concatenated after sequential processing',
);
assert.match(
  render,
  /"-map", "1:a:0"/,
  'final render must always map the original uploaded song audio',
);
assert.match(
  render,
  /"-c:v", "copy"/,
  'final concat/mux should stream-copy normalized video instead of re-encoding the whole timeline',
);
assert.match(render, /"movflags", "\+faststart"|"-movflags", "\+faststart"/);
assert.match(render, /rm\(workDir, \{ recursive: true, force: true \}\)/);
assert.doesNotMatch(render, /lipSyncTaskId|lipSyncModel/, 'renderer must not switch audio behavior based on lip-sync metadata');

const header = await readFile('apps/web/src/components/Header.tsx', 'utf8');
assert.match(header, />\\s*Preview MP4\\s*</);
assert.match(header, /Download MP4/);
assert.match(header, /downloadFromUrl\(renderUrl/);

const director = await readFile('apps/web/src/components/DirectorWorkspace.tsx', 'utf8');
assert.match(director, /ready to preview or download/);
assert.match(director, /downloadFromUrl\(url, "final-music-video\.mp4"\)/);
assert.match(director, />Preview MP4</);
assert.match(director, /Download MP4/);

console.log('final render policy test passed');
