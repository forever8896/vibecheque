#!/usr/bin/env bash
# Ingest a dance video URL into a playable VibeCheque track.
#
# Usage: scripts/ingest-track.sh <video-url> [--title "Override title"]
#
# Produces public/tracks/<id>/ with:
#   audio.mp3    — audio-only, 128k
#   choreo.json  — per-frame pose landmarks (MediaPipe Pose)
#   meta.json    — title, uploader, duration, source, extractedAt
#   cover.jpg    — thumbnail (best-effort)
#
# Also appends/updates public/tracks/index.json.
#
# Deps: yt-dlp, ffmpeg, jq, curl, python3 with mediapipe+opencv in a venv.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

URL=""
TITLE_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)
      TITLE_OVERRIDE="$2"
      shift 2
      ;;
    *)
      if [[ -z "$URL" ]]; then
        URL="$1"
      fi
      shift
      ;;
  esac
done

if [[ -z "$URL" ]]; then
  echo "usage: $(basename "$0") <video-url> [--title \"Override title\"]" >&2
  exit 2
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

ID="$(printf '%s' "$URL" | sha1sum | cut -c1-8)"
OUT="public/tracks/$ID"
mkdir -p "$OUT"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ [1/4] downloading $URL…"
yt-dlp "$URL" \
  -f "bv*[height<=720]+ba/b[height<=720]/best[height<=720]" \
  --recode-video mp4 \
  --write-info-json \
  --write-thumbnail \
  --convert-thumbnails jpg \
  -o "$TMP/video.%(ext)s" \
  2>&1 | tail -4

VIDEO=""
for ext in mp4 mkv webm; do
  if [[ -f "$TMP/video.$ext" ]]; then VIDEO="$TMP/video.$ext"; break; fi
done
INFO="$TMP/video.info.json"
THUMB="$(ls "$TMP"/video.jpg "$TMP"/video.webp 2>/dev/null | head -1 || true)"

if [[ -z "$VIDEO" ]]; then
  echo "✗ download failed, no video file in $TMP" >&2
  exit 1
fi

echo "→ [2/4] extracting audio.mp3…"
ffmpeg -loglevel error -i "$VIDEO" -vn -acodec libmp3lame -b:a 128k -y "$OUT/audio.mp3"

echo "→ [3/4] extracting pose landmarks…"
"$VENV/bin/python" "$SCRIPT_DIR/extract_choreo.py" "$VIDEO" "$OUT/choreo.json" --every-nth 2

echo "→ [4/4] writing meta.json + cover.jpg…"

TITLE_FROM_INFO="$(jq -r '.title // "Untitled"' "$INFO" 2>/dev/null || echo Untitled)"
TITLE="${TITLE_OVERRIDE:-$TITLE_FROM_INFO}"
UPLOADER="$(jq -r '.uploader // .channel // ""' "$INFO" 2>/dev/null || echo "")"
DURATION_SEC="$(jq -r '.duration // 0' "$INFO" 2>/dev/null || echo 0)"
WEBPAGE="$(jq -r '.webpage_url // .original_url // empty' "$INFO" 2>/dev/null || echo "$URL")"
[[ -z "$WEBPAGE" ]] && WEBPAGE="$URL"

if [[ -n "$THUMB" && -f "$THUMB" ]]; then
  # Re-encode to jpg if needed
  ffmpeg -loglevel error -y -i "$THUMB" -vframes 1 "$OUT/cover.jpg" 2>/dev/null || cp "$THUMB" "$OUT/cover.jpg"
fi

EXTRACTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

jq -n \
  --arg id "$ID" \
  --arg title "$TITLE" \
  --arg uploader "$UPLOADER" \
  --argjson durationSec "$DURATION_SEC" \
  --arg source "$WEBPAGE" \
  --arg extractedAt "$EXTRACTED_AT" \
  '{ id: $id, title: $title, uploader: $uploader, durationSec: $durationSec, source: $source, hasCover: (env.THUMB != null and env.THUMB != ""), extractedAt: $extractedAt }' \
  > "$OUT/meta.json"

# Update tracks/index.json
INDEX="public/tracks/index.json"
if [[ ! -f "$INDEX" ]]; then
  echo '{"tracks":[]}' > "$INDEX"
fi

# durationMs comes from choreo.json (more accurate than yt-dlp's seconds)
DUR_MS="$(jq -r '.durationMs // 0' "$OUT/choreo.json")"
FRAMES="$(jq -r '.frameCount // 0' "$OUT/choreo.json")"

# Replace existing entry with same id, then append
TMP_INDEX="$(mktemp)"
jq --arg id "$ID" \
   --arg title "$TITLE" \
   --arg uploader "$UPLOADER" \
   --argjson durationMs "$DUR_MS" \
   --argjson frames "$FRAMES" \
   --arg source "$WEBPAGE" \
   '.tracks = ((.tracks // []) | map(select(.id != $id))) + [{id: $id, title: $title, uploader: $uploader, durationMs: $durationMs, frames: $frames, source: $source}]' \
   "$INDEX" > "$TMP_INDEX"
mv "$TMP_INDEX" "$INDEX"

echo
echo "✓ track ingested: $ID"
echo "    $OUT/audio.mp3"
echo "    $OUT/choreo.json   ($FRAMES frames, ${DUR_MS}ms)"
echo "    $OUT/meta.json     (title: $TITLE)"
echo "    $INDEX             (updated)"
