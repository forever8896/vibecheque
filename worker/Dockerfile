# Vibecheque ingest worker. Receives POST /ingest from the Vercel app,
# pulls the raw upload from Vercel Blob, runs ffmpeg + MediaPipe pose
# extraction, uploads the processed outputs back to Blob, then POSTs the
# URLs to the Vercel callback. Deploy to Railway/Fly with the env vars:
#   BLOB_READ_WRITE_TOKEN  (same token as Vercel)
#   WORKER_SECRET          (shared secret, matches Vercel env)
#   PORT                   (Railway injects this)

FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-venv python3-pip jq curl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create a dedicated mediapipe venv once and bake it into the image so
# cold starts are fast. (OpenCV headless keeps the image slim.)
RUN python3 -m venv /opt/mp_env \
 && /opt/mp_env/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/mp_env/bin/pip install --no-cache-dir mediapipe opencv-python-headless

# Preload the pose landmarker model (~5.6 MB) so cold ingests don't
# pull it over the network.
RUN mkdir -p /app/models \
 && curl -fsSL \
      "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" \
      -o /app/models/pose_landmarker_lite.task

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.ts ./
COPY tsconfig.json ./
COPY extract_choreo.py ./

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npx", "tsx", "server.ts"]
