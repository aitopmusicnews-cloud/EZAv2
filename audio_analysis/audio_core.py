"""Resource-bounded local audio analysis used by the Fastify API.

The Render service has a small CPU/memory envelope, so this module deliberately
avoids librosa's dynamic-programming beat tracker and CQT chroma path.  Those
operations pushed production analysis to the 512 MiB ceiling and caused the
Node wrapper to terminate Python at its five-minute timeout.
"""

from __future__ import annotations

import io
import math
from typing import Any


TARGET_SR = 11_025
FRAME_LENGTH = 1_024
HOP_LENGTH = 256
KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _load_mono(audio_bytes: bytes, target_sr: int = TARGET_SR) -> tuple[Any, int]:
    """Decode with libsndfile and downsample before feature extraction.

    soundfile handles MP3/WAV/FLAC/OGG/Opus with bounded memory.  Some systems
    do not expose AAC/M4A through libsndfile, so keep a lazy librosa fallback
    for those less-common containers without paying its runtime cost for MP3.
    """
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly

    try:
        decoded, source_sr = sf.read(io.BytesIO(audio_bytes), dtype="float32", always_2d=False)
        if decoded.ndim == 2:
            decoded = decoded.mean(axis=1, dtype=np.float32)
        y = np.asarray(decoded, dtype=np.float32)
    except Exception:
        # Compatibility fallback for containers libsndfile cannot decode on a
        # particular host (notably some AAC/M4A files).
        import librosa

        y, source_sr = librosa.load(io.BytesIO(audio_bytes), sr=target_sr, mono=True)
        y = np.asarray(y, dtype=np.float32)
        source_sr = target_sr

    if y.size == 0:
        raise ValueError("audio is empty")

    source_sr = int(source_sr)
    if source_sr <= 0:
        raise ValueError("audio sample rate is invalid")

    if source_sr != target_sr:
        divisor = math.gcd(source_sr, target_sr)
        y = resample_poly(y, target_sr // divisor, source_sr // divisor).astype(np.float32, copy=False)
        source_sr = target_sr

    # Reject NaN/Inf from corrupt decoders before downstream FFTs.
    if not np.isfinite(y).all():
        y = np.nan_to_num(y, copy=False)

    return y, source_sr


def _frame_rms(y: Any, frame_length: int, hop_length: int) -> Any:
    """RMS envelope via cumulative sums (linear time, no framed audio copy)."""
    import numpy as np

    if len(y) < frame_length:
        value = float(np.sqrt(np.mean(np.square(y, dtype=np.float64))))
        return np.array([value], dtype=np.float32)

    squared = np.square(y, dtype=np.float64)
    cumulative = np.empty(len(squared) + 1, dtype=np.float64)
    cumulative[0] = 0.0
    np.cumsum(squared, out=cumulative[1:])
    starts = np.arange(0, len(y) - frame_length + 1, hop_length, dtype=np.int64)
    sums = cumulative[starts + frame_length] - cumulative[starts]
    return np.sqrt(sums / frame_length).astype(np.float32)


def _tempo_and_onsets(rms: Any, hop_seconds: float) -> tuple[float, list[float]]:
    """Estimate tempo from the positive RMS derivative and return onset peaks."""
    import numpy as np
    from scipy.signal import find_peaks

    if len(rms) < 4:
        return 120.0, []

    envelope = np.maximum(0.0, np.diff(rms, prepend=rms[0])).astype(np.float32)
    smooth_frames = max(1, int(round(0.08 / hop_seconds)))
    if smooth_frames > 1:
        kernel = np.ones(smooth_frames, dtype=np.float32) / smooth_frames
        envelope = np.convolve(envelope, kernel, mode="same")

    median = float(np.median(envelope))
    mad = float(np.median(np.abs(envelope - median))) + 1e-9
    peak = float(envelope.max(initial=0.0))
    prominence = max(mad * 2.5, peak * 0.04)
    min_distance = max(1, int(round(0.07 / hop_seconds)))
    peaks, _ = find_peaks(envelope, distance=min_distance, prominence=prominence)
    onset_times = (peaks.astype(np.float64) * hop_seconds).tolist()

    centered = envelope - envelope.mean()
    if peak <= 1e-8 or np.allclose(centered, 0.0):
        return 120.0, onset_times

    # FFT autocorrelation keeps both memory and runtime bounded for long songs.
    n = len(centered)
    nfft = 1 << (2 * n - 1).bit_length()
    spectrum = np.fft.rfft(centered, n=nfft)
    autocorr = np.fft.irfft(spectrum * np.conj(spectrum), n=nfft)[:n]

    min_lag = max(1, int(round((60.0 / 220.0) / hop_seconds)))
    max_lag = min(n - 1, int(round((60.0 / 40.0) / hop_seconds)))
    if max_lag <= min_lag:
        return 120.0, onset_times

    lag = min_lag + int(np.argmax(autocorr[min_lag : max_lag + 1]))
    lag_f = float(lag)
    # Parabolic interpolation reduces hop-size quantization in the BPM value.
    if 1 <= lag < len(autocorr) - 1:
        left, center, right = autocorr[lag - 1], autocorr[lag], autocorr[lag + 1]
        denom = left - 2.0 * center + right
        if abs(denom) > 1e-12:
            lag_f += float(0.5 * (left - right) / denom)

    bpm = 60.0 / max(lag_f * hop_seconds, 1e-6)
    while bpm < 70.0:
        bpm *= 2.0
    while bpm > 180.0:
        bpm /= 2.0
    return float(bpm), onset_times


def _beat_grid(duration: float, bpm: float, onsets: list[float]) -> tuple[list[float], list[float]]:
    """Build a stable beat grid from BPM, phase-aligned to an early onset."""
    import numpy as np

    period = 60.0 / max(bpm, 1.0)
    early = [t for t in onsets if t <= min(duration, period * 4.0)]
    anchor = early[0] if early else 0.0
    phase = anchor % period
    beats = np.arange(phase, duration + 1e-9, period, dtype=np.float64).tolist()
    if not beats:
        beats = [0.0]
    return beats, beats[::4]


def _pitch_profiles(y: Any, sr: int, window_seconds: float = 2.0) -> tuple[Any, list[Any], list[float]]:
    """Accumulate a lightweight FFT pitch-class profile for key/sections."""
    import numpy as np

    n_fft = 4_096
    step = max(n_fft, int(round(window_seconds * sr)))
    frequencies = np.fft.rfftfreq(n_fft, 1.0 / sr)
    valid = (frequencies >= 55.0) & (frequencies <= min(5_000.0, sr / 2.0))
    valid_frequencies = frequencies[valid]
    midi = np.rint(69.0 + 12.0 * np.log2(valid_frequencies / 440.0)).astype(int)
    pitch_classes = np.mod(midi, 12)
    window = np.hanning(n_fft).astype(np.float32)

    total = np.zeros(12, dtype=np.float64)
    profiles: list[Any] = []
    times: list[float] = []
    last_start = max(0, len(y) - n_fft)
    starts = range(0, max(1, last_start + 1), step)

    for start in starts:
        segment = y[start : start + n_fft]
        if len(segment) < n_fft:
            segment = np.pad(segment, (0, n_fft - len(segment)))
        magnitude = np.abs(np.fft.rfft(segment * window))
        profile = np.bincount(pitch_classes, weights=magnitude[valid], minlength=12).astype(np.float64)
        if profile.sum() > 0:
            profile /= profile.sum()
        total += profile
        profiles.append(profile)
        times.append(start / sr)

    if total.sum() > 0:
        total /= total.sum()
    return total, profiles, times


def _detect_sections(
    *,
    duration: float,
    bpm: float,
    rms: Any,
    hop_seconds: float,
    pitch_profiles: list[Any],
    pitch_times: list[float],
    sections_k: int,
) -> list[dict[str, Any]]:
    """Find structural changes from 8-second pitch/dynamics windows."""
    import numpy as np

    if duration <= 12.0:
        return [{"start": 0.0, "end": float(duration), "label": "section 1"}]

    window_seconds = 8.0
    starts = np.arange(0.0, duration, window_seconds)
    features: list[Any] = []

    for start in starts:
        end = min(duration, float(start + window_seconds))
        rms_start = max(0, int(start / hop_seconds))
        rms_end = max(rms_start + 1, min(len(rms), int(math.ceil(end / hop_seconds))))
        rr = rms[rms_start:rms_end]
        rms_mean = float(rr.mean()) if len(rr) else 0.0
        rms_std = float(rr.std()) if len(rr) else 0.0
        pitches = [profile for profile, time in zip(pitch_profiles, pitch_times) if start <= time < end]
        pitch_mean = np.mean(pitches, axis=0) if pitches else np.zeros(12, dtype=np.float64)
        features.append(np.concatenate([pitch_mean, [rms_mean, rms_std]]))

    if len(features) < 3:
        return [{"start": 0.0, "end": float(duration), "label": "section 1"}]

    matrix = np.vstack(features)
    scale = matrix.std(axis=0) + 1e-6
    normalized = (matrix - matrix.mean(axis=0)) / scale
    novelty = np.linalg.norm(np.diff(normalized, axis=0), axis=1)

    desired = (
        max(4, min(12, int(round(duration / 25.0))))
        if sections_k <= 0
        else max(2, sections_k)
    )
    bar_duration = 60.0 / max(bpm, 1.0) * 4.0
    min_section = max(8.0, bar_duration * 2.0)
    boundaries = [0.0, float(duration)]

    for index in np.argsort(novelty)[::-1]:
        candidate = float(starts[index + 1])
        if all(abs(candidate - existing) >= min_section for existing in boundaries):
            boundaries.append(candidate)
            if len(boundaries) - 1 >= desired:
                break

    boundaries.sort()
    return [
        {
            "start": float(boundaries[i]),
            "end": float(boundaries[i + 1]),
            "label": f"section {i + 1}",
        }
        for i in range(len(boundaries) - 1)
    ]


def analyze_bytes(audio_bytes: bytes, sections_k: int = 0) -> dict[str, Any]:
    """Return BPM, beat grid, onsets, RMS, key, and structural sections."""
    import numpy as np

    y, sr = _load_mono(audio_bytes)
    duration = float(len(y) / sr)
    hop_seconds = HOP_LENGTH / sr

    rms = _frame_rms(y, FRAME_LENGTH, HOP_LENGTH)
    bpm, onsets = _tempo_and_onsets(rms, hop_seconds)
    beats, downbeats = _beat_grid(duration, bpm, onsets)

    n_seconds = max(1, int(round(duration)))
    rms_times = np.arange(len(rms), dtype=np.float64) * hop_seconds
    target_times = np.linspace(0.0, duration, n_seconds)
    rms_resampled = np.interp(
        target_times,
        rms_times,
        rms,
        left=float(rms[0]),
        right=float(rms[-1]),
    )
    rms_max = float(rms_resampled.max()) or 1.0
    rms_curve = (rms_resampled / rms_max).tolist()

    pitch_total, pitch_windows, pitch_times = _pitch_profiles(y, sr)
    key = KEY_NAMES[int(np.argmax(pitch_total))] if pitch_total.size else "C"
    sections = _detect_sections(
        duration=duration,
        bpm=bpm,
        rms=rms,
        hop_seconds=hop_seconds,
        pitch_profiles=pitch_windows,
        pitch_times=pitch_times,
        sections_k=sections_k,
    )

    return {
        "duration": duration,
        "bpm": bpm,
        "key": key,
        "beats": beats,
        "downbeats": downbeats,
        "onsets": onsets,
        "rms_curve": rms_curve,
        "sections": sections,
    }
