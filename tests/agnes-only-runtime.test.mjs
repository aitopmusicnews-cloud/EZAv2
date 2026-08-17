import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const server = await readFile('apps/api/src/server.ts','utf8');
const sidebar = await readFile('apps/web/src/components/Sidebar.tsx','utf8');
const scheduler = await readFile('apps/web/src/lib/scheduler.ts','utf8');
const shared = await readFile('packages/shared/src/index.ts','utf8');
const env = await readFile('.env.example','utf8');
assert.match(server,/\/api\/generate\/image-to-video/);
assert.match(server,/\/api\/generate\/text-to-video/);
assert.match(server,/\/api\/generate\/keyframe-to-video/);
for (const [name,src] of [['server',server],['sidebar',sidebar],['scheduler',scheduler],['shared',shared],['env',env]]) {
  assert.doesNotMatch(src,/Runway|RUNWAY|Veo|veo|SeedDance|seedance|Fal AI|FAL_|Aleph|aleph|lipSync|lip-sync|Hunyuan|Wan 2\.1|LOCAL_INFERENCE/i, `${name} contains retired provider path`);
}
assert.match(sidebar,/Text → Video/);
assert.match(sidebar,/Image → Video/);
assert.match(sidebar,/Keyframe → Video/);
assert.match(shared,/agnes-video-v2\.0/);
assert.doesNotMatch(scheduler,/requiresCharacter/, 'scheduler should use ordinary Agnes reference images, not a provider-specific character gate');
console.log('agnes-only runtime tests passed');
