#!/usr/bin/env python3
"""Offline choreography extractor using MediaPipe Tasks Vision.

Runs Pose Landmarker over a video file and writes a JSON of per-frame
landmarks compatible with the app's choreography loader.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2  # type: ignore
import mediapipe as mp  # type: ignore
from mediapipe.tasks import python as mp_python  # type: ignore
from mediapipe.tasks.python import vision  # type: ignore

DEFAULT_MODEL = Path(__file__).parent / "models" / "pose_landmarker_lite.task"


def main():
    if len(sys.argv) < 3:
        print(
            "usage: extract_choreo.py <input.mp4> <output.json> [--every-nth N]",
            file=sys.stderr,
        )
        sys.exit(2)

    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    every_nth = 1
    if "--every-nth" in sys.argv:
        i = sys.argv.index("--every-nth")
        every_nth = max(1, int(sys.argv[i + 1]))
    if not src.is_file():
        print(f"source not found: {src}", file=sys.stderr)
        sys.exit(2)
    if not DEFAULT_MODEL.is_file():
        print(f"model missing: {DEFAULT_MODEL}", file=sys.stderr)
        sys.exit(2)

    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        print(f"could not open: {src}", file=sys.stderr)
        sys.exit(2)

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration_ms = int((total_frames / fps) * 1000) if fps else 0
    print(
        f"input: {src.name}  {width}x{height}  fps={fps:.2f}  "
        f"frames={total_frames}  duration={duration_ms}ms  every_nth={every_nth}"
    )

    base_opts = mp_python.BaseOptions(model_asset_path=str(DEFAULT_MODEL))
    opts = vision.PoseLandmarkerOptions(
        base_options=base_opts,
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
    )
    landmarker = vision.PoseLandmarker.create_from_options(opts)

    frames: list[dict] = []
    idx = 0
    start = time.time()

    while True:
        ok, frame_bgr = cap.read()
        if not ok:
            break
        if idx % every_nth == 0:
            t_ms = int((idx / fps) * 1000)
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = landmarker.detect_for_video(mp_image, t_ms)
            if result.pose_landmarks:
                pts = result.pose_landmarks[0]
                frames.append(
                    {
                        "t": t_ms,
                        "lm": [
                            {
                                "x": round(float(p.x), 4),
                                "y": round(float(p.y), 4),
                                "v": round(float(p.visibility), 2),
                            }
                            for p in pts
                        ],
                    }
                )
        idx += 1
        if idx % 120 == 0:
            pct = (idx / total_frames * 100) if total_frames else 0
            print(f"  …{idx}/{total_frames} ({pct:.1f}%) kept {len(frames)}")

    cap.release()
    landmarker.close()

    elapsed = time.time() - start
    avg_fps = (len(frames) / (duration_ms / 1000)) if duration_ms else 0
    out = {
        "source": src.name,
        "videoWidth": width,
        "videoHeight": height,
        "durationMs": duration_ms,
        "frameCount": len(frames),
        "avgFps": round(avg_fps, 2),
        "extractedAt": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "frames": frames,
    }
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, separators=(",", ":")))
    print(
        f"wrote {dst}  {len(frames)} frames  "
        f"{dst.stat().st_size / 1024:.1f} KB  in {elapsed:.1f}s"
    )


if __name__ == "__main__":
    main()
