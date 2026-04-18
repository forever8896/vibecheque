import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type Match = {
  id: string;
  startAt: number;
  duration: number;
};

// In-memory match store. Fine for a single-process hackathon server.
// Would need Redis/DB to survive across Next.js workers or serverless.
const store: { current: Match | null } = { current: null };

const DEFAULT_DURATION_MS = 45_000;
const COUNTDOWN_MS = 5_000;
const KEEP_ENDED_FOR_MS = 30_000;

function pruneIfExpired(now: number) {
  const m = store.current;
  if (m && now > m.startAt + m.duration + KEEP_ENDED_FOR_MS) {
    store.current = null;
  }
}

export async function GET() {
  const now = Date.now();
  pruneIfExpired(now);
  return NextResponse.json({ match: store.current, serverNow: now });
}

export async function POST(req: NextRequest) {
  const now = Date.now();
  pruneIfExpired(now);

  const existing = store.current;
  if (existing && now < existing.startAt + existing.duration) {
    return NextResponse.json(
      { match: existing, serverNow: now, alreadyRunning: true },
      { status: 200 },
    );
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const duration =
    typeof body.duration === "number" && body.duration > 0
      ? Math.min(180_000, body.duration)
      : DEFAULT_DURATION_MS;

  store.current = {
    id: Math.random().toString(36).slice(2, 10),
    startAt: now + COUNTDOWN_MS,
    duration,
  };
  return NextResponse.json({ match: store.current, serverNow: now });
}
