# vibecheque ingest worker

Long-running service that runs the VibeCheque ingest pipeline (ffmpeg
+ MediaPipe pose extraction) so the Vercel-hosted Next.js app can stay
serverless. Deploy this to Railway / Fly / Render / a VPS — anywhere
you can run a Docker image with ~500 MB RAM and a few minutes of CPU
per upload.

## Flow

```
browser  ──upload──▶  Vercel Blob       (direct from the client)
                           │
Vercel /api/track-upload-cloud ──POST /ingest──▶  this service
                                                        │
            this service ──PUT──▶  Vercel Blob (processed outputs)
                                                        │
            this service ──POST callback──▶  Vercel /api/track-callback
                                                        │
                                          Redis row → status=ready
```

## Env vars

See `.env.example`. On Railway they live in the project's *Variables*
tab.

| var                      | where from                                        |
| ------------------------ | ------------------------------------------------- |
| `BLOB_READ_WRITE_TOKEN`  | Vercel dashboard → Storage → Blob. Same token as the main app. |
| `WORKER_SECRET`          | Anything long + random. Paste the same value into the Vercel project's env. |
| `PORT`                   | Railway injects automatically.                    |

## Deploy to Railway

1. `railway login`, then `railway init` inside `worker/` (or create a
   project in the dashboard).
2. Add the env vars above.
3. `railway up` — Railway detects the Dockerfile and builds. First
   build takes ~5 min because it provisions a Python venv with
   `mediapipe` and pre-downloads the pose landmarker model.
4. Copy the public URL Railway assigns you (looks like
   `https://vibecheque-worker-production.up.railway.app`).
5. Paste that URL into the Vercel project as `WORKER_URL`.

## Local smoke test

```bash
docker build -t vibecheque-worker worker/
docker run --rm -p 3000:3000 \
  -e BLOB_READ_WRITE_TOKEN=... \
  -e WORKER_SECRET=dev-secret \
  vibecheque-worker

# in another shell:
curl -X POST http://localhost:3000/ingest \
  -H 'content-type: application/json' \
  -H 'x-worker-secret: dev-secret' \
  -d '{
    "trackId": "abcd1234",
    "title": "Test",
    "sourceUrl": "https://your-blob.vercel-storage.com/test.mp4",
    "callbackUrl": "https://webhook.site/your-id",
    "callbackSecret": "dev-secret"
  }'
```

You should see the worker post `{status: "processing"}` immediately,
then `{status: "ready", videoUrl: ..., ...}` after the pipeline finishes
(tens of seconds to a few minutes depending on clip length).
