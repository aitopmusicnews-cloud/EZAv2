import io
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "audio_analysis"))
from audio_core import analyze_bytes

sr = 22050
duration = 8.0
t = np.arange(int(sr * duration)) / sr
y = (0.05 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
buf = io.BytesIO()
sf.write(buf, y, sr, format="WAV", subtype="PCM_16")
result = analyze_bytes(buf.getvalue())
assert result["duration"] > 7.5
assert result["sections"]
assert result["sections"][0]["start"] == 0.0
assert abs(result["sections"][-1]["end"] - result["duration"]) < 1e-6
print("sparse/no-beat audio analysis fallback passed")
