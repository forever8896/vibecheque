# VibeCheque scripts

## `ingest-track.sh`

URL → playable VibeCheque track. Downloads the video, extracts audio, runs
MediaPipe Pose, pulls the cover art, and writes a bundle at
`public/tracks/<id>/`.

```bash
scripts/ingest-track.sh "https://www.tiktok.com/@someone/video/12345"
scripts/ingest-track.sh "https://www.youtube.com/watch?v=xyz"
```

Works with anything yt-dlp supports (YouTube, TikTok, Instagram Reels,
Facebook, Reddit…). For TikTok specifically you need the impersonation
backend — install it once per machine:

```bash
pip install --user --break-system-packages "yt-dlp[default,curl-cffi]"
```

Without `curl-cffi` TikTok's anti-bot returns `Requested format is not
available`.

Output after a successful run:

- `public/tracks/<id>/audio.mp3`
- `public/tracks/<id>/choreo.json`  (pose landmarks per frame)
- `public/tracks/<id>/meta.json`    (title, uploader, duration, source)
- `public/tracks/<id>/cover.jpg`
- `public/tracks/index.json`        (updated)

Commit + push the new folder and `index.json` — the track shows up in the
lobby selector after Vercel rebuilds.

## `extract_choreo.py`

Run MediaPipe Pose over a dance video file and emit a JSON of time-stamped
landmarks that the app's choreography loader reads.

### One-time setup

```bash
# virtualenv (don't pollute system Python)
python3 -m venv /tmp/mp_env
/tmp/mp_env/bin/pip install mediapipe opencv-python-headless

# download the pose model (5.6 MB, gitignored)
mkdir -p scripts/models
curl -L "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" \
  -o scripts/models/pose_landmarker_lite.task
```

### Extract

```bash
# takes ~20s for a 30s 60fps clip on a modern GPU
/tmp/mp_env/bin/python scripts/extract_choreo.py \
  public/dance-sample.mp4 \
  public/choreo.json \
  --every-nth 2
```

`--every-nth 2` samples every second frame (30 fps from a 60 fps source).
Drop it for real-time sampling.

The emitted `choreo.json` is auto-loaded by `app/room/choreography.ts`
whenever the room mounts. During `playing` phase the pose scorer targets
the time-aligned frame from this JSON instead of the procedural pose
library.

### Source video gotchas

- Gitignored. Use any dance video — ideally single dancer, full body in
  frame, stable camera. The legal status of the clip doesn't leave your
  machine because we only ship the derived pose data.
- Match duration (45 s) may outlast the choreo; the loader loops the
  frames, so a 32s choreo plays 1.4× over a 45s match.
