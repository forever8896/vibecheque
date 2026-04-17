# VibeCheque

> A multiplayer dancing game you can only win with your actual body.

Built at **ETHSilesia 2026**, Apr 17–19, spinPLACE Katowice.

Put on sunglasses. Join a room. Dance. Money streams from the worst dancers to
the best while the song plays. Take the sunglasses off to meet the people you
just danced with.

It's a human-first, embodied, anti-AI response to a world drowning in
generated slop. You cannot fake this with an LLM. You have to move your body,
in front of a camera, in real time, with strangers.

## How it works

1. **Sunglasses gate.** MediaPipe FaceMesh checks you're actually wearing
   sunglasses before it lets you in.
2. **Shared room.** LiveKit SFU fans out everyone's webcam. One hardcoded room
   for the hackathon — no matchmaking.
3. **Synced track.** Server emits a `trackStart` timestamp; each client
   schedules playback against its own `performance.now()` offset.
4. **Scoring.** MediaPipe Pose runs in-browser at ~15–30 fps. Your score is
   the correlation between your keypoint-velocity vector and the track's
   precomputed beat envelope, smoothed with an EMA.
5. **Streaming money.** Superfluid on Base Sepolia. Everyone opens a
   constant-rate outflow into a room escrow at match start. Every tick, the
   top-half scorers receive; the bottom half don't. At the end of the track,
   streams close and settle.
6. **Say hi.** Post-match screen offers "Dance again" or "Say hi" — the latter
   opens a short-lived chat room for the people you just danced with.

## Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind 4
- **CV:** `@mediapipe/tasks-vision` (Pose Landmarker, Face Landmarker)
- **Realtime A/V:** LiveKit Cloud (video, audio, data channels)
- **Wallet:** Privy (embedded + social login, Base Sepolia default)
- **Chain:** Base Sepolia + Superfluid streaming payments
- **Hosting:** Vercel

## Run locally

```bash
bun install
cp .env.example .env.local   # fill in the values
bun dev
```

Open two tabs at [localhost:3000](http://localhost:3000) and join the room
from each to see the webcam grid.

### Environment

| Key                        | Where                                  |
| -------------------------- | -------------------------------------- |
| `LIVEKIT_API_KEY`          | [cloud.livekit.io](https://cloud.livekit.io) → Settings → Keys |
| `LIVEKIT_API_SECRET`       | same                                   |
| `LIVEKIT_URL`              | `wss://<project>.livekit.cloud`        |
| `NEXT_PUBLIC_LIVEKIT_URL`  | same as `LIVEKIT_URL`                  |
| `NEXT_PUBLIC_PRIVY_APP_ID` | [dashboard.privy.io](https://dashboard.privy.io) |
| `NEXT_PUBLIC_ROOM_NAME`    | defaults to `vibecheque-main`          |

## Status

Hackathon WIP. See [`~/ethsilesia/PRD.md`](PRD.md) (local) for the full
milestone plan.

- [x] Next.js + Tailwind + LiveKit + Privy scaffold
- [x] Webcam tile grid, hardcoded room
- [ ] Sunglasses gate (FaceMesh)
- [ ] Pose scoring loop + beat-envelope correlation
- [ ] Synchronized track playback
- [ ] Superfluid streaming escrow on Base Sepolia
- [ ] Money-flow UI overlay
- [ ] Post-match "Say hi" chat

## Known limits

- Client-authoritative scoring — cheatable. Future work: ZK pose proof or
  TEE-attested scoring.
- One hardcoded room. No lobbies.
- Base Sepolia only. Mainnet-ready architecture, not mainnet-deployed.
- Desktop Chrome only.

## License

GPLv3. Made during ETHSilesia 2026 hackathon.
