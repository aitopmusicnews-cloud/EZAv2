import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile('audio_analysis/audio_core.py', 'utf8');

// Render's free service has a tight memory/CPU envelope. These two librosa
// operations were the production hot spots that pushed analysis to the 512 MiB
// memory ceiling and caused the Node wrapper to kill Python after five minutes.
assert.doesNotMatch(core, /librosa\.beat\.beat_track\s*\(/);
assert.doesNotMatch(core, /librosa\.feature\.chroma_cqt\s*\(/);

// The replacement analyzer must decode locally, downsample, and use bounded
// scipy/numpy operations rather than restoring the expensive path above.
assert.match(core, /soundfile/);
assert.match(core, /resample_poly/);

console.log('audio analysis Render budget regression test passed');
