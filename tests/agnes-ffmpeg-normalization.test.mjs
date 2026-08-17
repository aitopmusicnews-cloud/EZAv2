import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js';

const root = new URL('..', import.meta.url);
const sourcePath = new URL('../apps/api/src/ffmpeg.ts', import.meta.url);
const source = readFileSync(sourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const dir = mkdtempSync(join(tmpdir(), 'agnes-ffmpeg-'));
try {
  const modulePath = join(dir, 'ffmpeg.mjs');
  const input = join(dir, 'provider.mp4');
  const output = join(dir, 'normalized.mp4');
  writeFileSync(modulePath, transpiled);

  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '2.5',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', input,
  ]);

  const { normalizeGeneratedVisual } = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);
  await normalizeGeneratedVisual(input, output, 1.7, '16:9');

  const probe = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,codec_name,pix_fmt,width,height',
    '-of', 'json', output,
  ], { encoding: 'utf8' }));

  const duration = Number(probe.format.duration);
  assert.ok(Math.abs(duration - 1.7) <= 0.08, `expected ~1.7s, got ${duration}`);
  const video = probe.streams.find((s) => s.codec_type === 'video');
  assert.ok(video, 'normalized output must contain video');
  assert.equal(video.codec_name, 'h264');
  assert.equal(video.pix_fmt, 'yuv420p');
  assert.equal(video.width, 1280);
  assert.equal(video.height, 720);
  assert.equal(probe.streams.some((s) => s.codec_type === 'audio'), false, 'Agnes clip audio must be removed');

  console.log('agnes ffmpeg normalization test passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
