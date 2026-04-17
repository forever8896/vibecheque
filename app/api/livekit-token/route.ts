import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !wsUrl) {
    return NextResponse.json(
      { error: "LiveKit server env not configured" },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const identity =
    url.searchParams.get("identity") ??
    `guest-${Math.random().toString(36).slice(2, 10)}`;
  const room =
    url.searchParams.get("room") ??
    process.env.NEXT_PUBLIC_ROOM_NAME ??
    "vibecheque-main";
  const name = url.searchParams.get("name") ?? identity;

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: "30m",
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();
  return NextResponse.json({ token, url: wsUrl, room, identity });
}
