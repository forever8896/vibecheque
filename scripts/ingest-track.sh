#!/usr/bin/env bash
# Ingest a dance video (URL or local file) into a playable VibeCheque track.
#
# Usage:
#   scripts/ingest-track.sh <video-url>             [--title "Override"]
#   scripts/ingest-track.sh ./path/to/recording.mp4 [--title "My Dance"]
#
# Produces public/tracks/<id>/ with:
#   video.mp4    — normalized H.264 mp4, ≤ 720p (web playback)
#   audio.mp3    — audio-only, 128k
#   choreo.json  — per-frame pose landmarks (MediaPipe Pose)
#   meta.json    — title, uploader, duration, source, extractedAt
#   cover.jpg    — thumbnail (best-effort)
#
# Also appends/updates public/tracks/index.json.
#
# Deps: yt-dlp (URL mode only), ffmpeg, jq, python3 with mediapipe+opencv.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

INPUT=""
TITLE_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)
      TITLE_OVERRIDE="$2"
      shift 2
      ;;
    *)
      if [[ -z "$INPUT" ]]; then
        INPUT="$1"
      fi
      shift
      ;;
  esac
done

if [[ -z "$INPUT" ]]; then
  echo "usage: $(basename "$0") <video-url-or-file> [--title \"Override title\"]" >&2
  exit 2
fi

IS_LOCAL=0
if [[ -f "$INPUT" ]]; then
  IS_LOCAL=1
fi

VENV="/tmp/mp_env"
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "→ creating mediapipe venv at $VENV…"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet mediapipe opencv-python-headless
fi

MODEL="$SCRIPT_DIR/models/pose_landmarker_lite.task"
if [[ ! -f "$MODEL" ]]; then
  echo "→ downloading pose model…"
  mkdir -p "$(dirname "$MODEL")"
  curl -fsSL "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" -o "$MODEL"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

VIDEO=""
INFO=""
THUMB=""
SOURCE_URL=""
UPLOADER=""
DURATION_SEC="0"

if [[ "$IS_LOCAL" -eq 1 ]]; then
  ABS="$(cd "$(dirname "$INPUT")" && pwd)/$(basename "$INPUT")"
  ID="$(printf '%s' "$ABS" | sha1sum | cut -c1-8)"
  VIDEO="$ABS"
  SOURCE_URL="file://$ABS"
  # Title falls back to the filename (without extension) if not overridden
  BASENAME="$(basename "$ABS")"
  TITLE_FROM_FILE="${BASENAME%.*}"
  TITLE="${TITLE_OVERRIDE:-$TITLE_FROM_FILE}"
  DURATION_SEC="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$VIDEO" 2>/dev/null | awk '{printf "%d", $1}')"
  echo "→ [1/4] local file ($BASENAME, ${DURATION_SEC}s)…"
else
  ID="$(printf '%s' "$INPUT" | sha1sum | cut -c1-8)"
  echo "→ [1/4] downloading $INPUT…"
  yt-dlp "$INPUT" \
    -f "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b/best" \
    --recode-video mp4 \
    --write-info-json \
    --write-thumbnail \
    --convert-thumbnails jpg \
    -o "$TMP/video.%(ext)s" \
    2>&1 | tail -4
  for ext in mp4 mkv webm; do
    if [[ -f "$TMP/video.$ext" ]]; then VIDEO="$TMP/video.$ext"; break; fi
  done
  INFO="$TMP/video.info.json"
  THUMB="$(ls "$TMP"/video.jpg "$TMP"/video.webp 2>/dev/null | head -1 || true)"
  if [[ -z "$VIDEO" ]]; then
    echo "✗ download failed, no video file in $TMP" >&2
    exit 1
  fi
  TITLE_FROM_INFO="$(jq -r '.title // "Untitled"' "$INFO" 2>/dev/null || echo Untitled)"
  TITLE="${TITLE_OVERRIDE:-$TITLE_FROM_INFO}"
  UPLOADER="$(jq -r '.uploader // .channel // ""' "$INFO" 2>/dev/null || echo "")"
  DURATION_SEC="$(jq -r '.duration // 0' "$INFO" 2>/dev/null || echo 0)"
  SOURCE_URL="$(jq -r '.webpage_url // .original_url // empty' "$INFO" 2>/dev/null || echo "$INPUT")"
  [[ -z "$SOURCE_URL" ]] && SOURCE_URL="$INPUT"
fi

OUT="public/tracks/$ID"
mkdir -p "$OUT"

echo "→ [2/4] normalizing video.mp4…"
# Re-encode to web-friendly H.264/AAC mp4 with faststart, capped at 720p
# height. Output keeps audio so the lobby preview can play music from the
# video element directly.
ffmpeg -loglevel error -y -i "$VIDEO" \
  -vf "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  -c:v libx264 -preset veryfast -crf 23 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  "$OUT/video.mp4"

echo "→ [3/4] extracting audio.mp3 + choreo.json…"
ffmpeg -loglevel error -i "$OUT/video.mp4" -vn -acodec libmp3lame -b:a 128k -y "$OUT/audio.mp3"
"$VENV/bin/python" "$SCRIPT_DIR/extract_choreo.py" "$OUT/video.mp4" "$OUT/choreo.json" --every-nth 2

echo "→ [4/4] writing meta.json + cover.jpg…"

if [[ -n "$THUMB" && -f "$THUMB" ]]; then
  ffmpeg -loglevel error -y -i "$THUMB" -vframes 1 "$OUT/cover.jpg" 2>/dev/null || cp "$THUMB" "$OUT/cover.jpg"
else
  # Grab a frame a second or two in so we skip any black leader.
  GRAB_AT="00:00:01"
  if [[ "${DURATION_SEC%.*}" -lt 2 ]]; then GRAB_AT="00:00:00"; fi
  ffmpeg -loglevel error -y -ss "$GRAB_AT" -i "$OUT/video.mp4" -vframes 1 -q:v 3 "$OUT/cover.jpg" 2>/dev/null || true
fi

EXTRACTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

jq -n \
  --arg id "$ID" \
  --arg title "$TITLE" \
  --arg uploader "$UPLOADER" \
  --argjson durationSec "$DURATION_SEC" \
  --arg source "$SOURCE_URL" \
  --arg extractedAt "$EXTRACTED_AT" \
  '{ id: $id, title: $title, uploader: $uploader, durationSec: $durationSec, source: $source, hasVideo: true, extractedAt: $extractedAt }' \
  > "$OUT/meta.json"

# Update tracks/index.json
INDEX="public/tracks/index.json"
if [[ ! -f "$INDEX" ]]; then
  echo '{"tracks":[]}' > "$INDEX"
fi

# durationMs comes from choreo.json (more accurate than the source's seconds)
DUR_MS="$(jq -r '.durationMs // 0' "$OUT/choreo.json")"
FRAMES="$(jq -r '.frameCount // 0' "$OUT/choreo.json")"

TMP_INDEX="$(mktemp)"
jq --arg id "$ID" \
   --arg title "$TITLE" \
   --arg uploader "$UPLOADER" \
   --argjson durationMs "$DUR_MS" \
   --argjson frames "$FRAMES" \
   --arg source "$SOURCE_URL" \
   '.tracks = ((.tracks // []) | map(select(.id != $id))) + [{id: $id, title: $title, uploader: $uploader, durationMs: $durationMs, frames: $frames, source: $source, hasVideo: true}]' \
   "$INDEX" > "$TMP_INDEX"
mv "$TMP_INDEX" "$INDEX"

echo
echo "✓ track ingested: $ID"
echo "    $OUT/video.mp4"
echo "    $OUT/audio.mp3"
echo "    $OUT/choreo.json   ($FRAMES frames, ${DUR_MS}ms)"
echo "    $OUT/meta.json     (title: $TITLE)"
echo "    $INDEX             (updated)"
