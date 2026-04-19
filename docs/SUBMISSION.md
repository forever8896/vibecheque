# VibeCheque — Genesys submission copy

Draft. Swap the placeholders in CAPS before pasting.

---

**VibeCheque — a multiplayer dance floor you control with your body,
and the icebreaker that starts once the music stops.**

## The problem

Apps replaced rooms. Swipes replaced eye contact. The thing that used
to turn a stranger into a friend — being in the same moment, doing the
same slightly-ridiculous thing together — got optimized out of modern
life.

We put it back. First you dance together. Then you talk.

## What a player does

1. **Pass the sunglasses gate.** A MediaPipe face-landmarker confirms
   you're wearing them before it lets you onto the floor. Anonymity is
   the ice-breaker.
2. **Calibrate with a T-pose.** The gate sizes you up and brings you
   into the lobby.
3. **Pick a song with your arm.** Extend your right arm out
   horizontally for next, left for previous. Hold ~0.6 s to commit.
   The library is whatever the community has uploaded — TikToks,
   challenge dances, a clip you recorded last night.
4. **Dab to start.** One gesture, no buttons. The room locks, a
   five-second countdown syncs across every client, and the song
   starts for everyone at the same moment.
5. **Dance with the reference.** The selected video plays full-bleed
   on your tile, match-clock-synced. Your own MediaPipe skeleton
   overlays on top, mirror-flipped, and grades pink → green with how
   well your body fits the dancer's shape.
6. **Take the sunglasses off.** Music ends, the "chill room" opens,
   voice chat comes online, skeletons vanish. Now there's something
   real to talk about.

## What we built

- **Pose is the only input.** Every in-game control is a body pose:
  sunglasses detection (face landmarks), calibration (T-pose), song
  select (arm extend hold), match start (dab hold), leave (button, ok
  fine). No keyboards, no mice once you're on the floor.
- **Shared reference dance.** The selected video plays full-bleed on
  the local tile in match-clock sync (drift-corrected every frame).
  The player's MediaPipe skeleton overlays on top so they can feel
  their body landing on the dancer's shape in real time.
- **Community dance library.** Anyone can drop in an mp4. The server
  extracts a normalized H.264 ≤720p video, 128 kbps audio, and a
  per-frame MediaPipe pose skeleton. New track is live in ~30 s and
  visible to the whole lobby.
- **Multiplayer rooms.** LiveKit SFU for rooms up to 4 dancers. Match
  starts broadcast over the LiveKit data channel so every client
  enters countdown within a frame of each other; a 2 s polling
  fallback keeps stragglers in sync.
- **Deploy anywhere.** Next.js 16 app on Vercel, Vercel Blob for
  video/audio storage, Upstash Redis for track metadata, a separate
  Docker worker on Railway for the ffmpeg + MediaPipe pipeline. Local
  dev falls back to the filesystem with zero config — same
  `scripts/ingest-track.sh` works both ways.
- **Opt-in money layer.** Live streaming payouts between players on
  Base Sepolia — a buy-in-per-match escrow, the top half takes a
  share of the bottom half's stake. Settlement happens on-chain at
  match end; display is a simulated per-second flow pill so the money
  feels alive while the music plays. Feature-flagged; free-play is
  the default.

## Why it matters

You can't fake this with an LLM. The whole experience is *embodied*:
you have to move, in front of a camera, in real time, with actual
other people. That's the point — it's a human-first answer to a world
drowning in generated content. AI can write the song; it can't be
your dance partner.

## Try it

- **Play:** PLACEHOLDER — deployed app URL
- **Code:** https://github.com/forever8896/vibecheque
- **Demo video (5 min):** PLACEHOLDER — YouTube link

## Bounties / tracks

Submitting for: **Gaming**, **Innovation**, **AI**. Bounty names will
be listed on Genesys per the FAQ.

## Team

PLACEHOLDER — team members with their GitHub handles / wallet
addresses.

---

*Made during ETHSilesia 2026 hackathon.* (see `SOURCE.md`, GPL-3.0
license in `LICENSE`).
