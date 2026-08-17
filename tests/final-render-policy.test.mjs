import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const render = await readFile('apps/api/src/render.ts', 'utf8');
assert.match(render, /clip\.source === "textToVideo"/);
assert.match(render, /clip\.source === "imageToVideo"/);
assert.match(render, /clip\.source === "keyframeToVideo"/);
assert.match(render, /trim=duration=\$\{slotDur\.toFixed\(6\)\}/, 'Agnes footage must be hard-trimmed to timeline duration');
assert.match(render, /"-map", `\$\{audioIdx\}:a`/, 'final render must always map original uploaded song audio');
assert.doesNotMatch(render, /lipSyncTaskId|lipSyncModel/, 'renderer must not switch audio behavior based on lip-sync metadata');
assert.match(render, /"-movflags", "\+faststart"/);

const generatedBranch = render.slice(render.indexOf('const isAgnesGenerated'), render.indexOf('filterParts.push', render.indexOf('const isAgnesGenerated')));
assert.doesNotMatch(generatedBranch, /PTS-STARTPTS\)\*/, 'Agnes branch must not time-stretch generated footage');
console.log('final render policy test passed');
