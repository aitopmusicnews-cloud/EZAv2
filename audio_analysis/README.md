# Local audio_analysis

This folder contains the song analyzer used directly by the Fastify API.

Install:

```bash
python3 -m pip install -r audio_analysis/requirements.txt
```

Manual CLI usage:

```bash
python3 audio_analysis/analyze_cli.py /path/to/song.wav
```

The CLI prints JSON containing duration, BPM, key, beats, downbeats, onsets, RMS energy, and section boundaries. The API invokes it only for media owned by the project's configured local/S3 storage.
