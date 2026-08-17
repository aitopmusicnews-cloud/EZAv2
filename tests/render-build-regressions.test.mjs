import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const sharedPkg = JSON.parse(await readFile('packages/shared/package.json', 'utf8'));
assert.equal(sharedPkg.main, './dist/index.js');
assert.equal(sharedPkg.types, './dist/index.d.ts');
assert.match(sharedPkg.scripts?.build ?? '', /tsc -p tsconfig\.build\.json/);
await access('packages/shared/tsconfig.json');
await access('packages/shared/tsconfig.build.json');

const scheduler = await readFile('apps/web/src/lib/scheduler.ts', 'utf8');
assert.match(scheduler, /typeof output === "string"/);
assert.match(scheduler, /Array\.isArray\(output\)/);

const agnes = await readFile('apps/api/src/agnesVideo.ts', 'utf8');
assert.match(agnes, /const prompt = req\.promptText\.trim\(\)/);
assert.doesNotMatch(agnes, /req\.prompt\b/);
assert.doesNotMatch(agnes, /req\.imageUrl\b/);
assert.doesNotMatch(agnes, /req\.endImageUrl\b/);
console.log('render build regression checks passed');
