from __future__ import annotations

import io
import math
import struct
import unittest
import wave

from audio_core import analyze_bytes


def synthetic_song_bytes(duration: float = 12.0, sample_rate: int = 22050) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        frames = bytearray()
        for index in range(int(sample_rate * duration)):
            t = index / sample_rate
            value = 0.20 * math.sin(2 * math.pi * 440 * t)
            phase = t % 0.5
            if phase < 0.012:
                value += 0.55 * (1 - phase / 0.012)
            value = max(-0.95, min(0.95, value))
            frames.extend(struct.pack("<h", int(value * 32767)))
        output.writeframes(bytes(frames))
    return buffer.getvalue()


class AudioAnalysisTests(unittest.TestCase):
    def test_section_boundaries_from_synced_bins_stay_within_detected_beats(self) -> None:
        result = analyze_bytes(synthetic_song_bytes())

        self.assertGreater(result["duration"], 11.9)
        self.assertTrue(result["sections"])
        self.assertEqual(result["sections"][0]["start"], 0.0)
        self.assertAlmostEqual(result["sections"][-1]["end"], result["duration"], places=4)


if __name__ == "__main__":
    unittest.main()
