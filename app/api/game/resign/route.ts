import { NextRequest, NextResponse } from "next/server";
import { resign } from "@/lib/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { gameId, playerId } = body ?? {};
  if (!gameId || !playerId) {
    return NextResponse.json({ error: "parâmetros faltando" }, { status: 400 });
  }
  const result = await resign(gameId, playerId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result.game);
}
