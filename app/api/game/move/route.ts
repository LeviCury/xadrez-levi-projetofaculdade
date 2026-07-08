import { NextRequest, NextResponse } from "next/server";
import { applyMove } from "@/lib/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { gameId, playerId, from, to, promotion } = body ?? {};
  if (!gameId || !playerId || !from || !to) {
    return NextResponse.json({ error: "parâmetros faltando" }, { status: 400 });
  }
  const result = await applyMove({ gameId, playerId, from, to, promotion });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, game: result.game },
      { status: 400 }
    );
  }
  return NextResponse.json(result.game);
}
