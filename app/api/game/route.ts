import { NextRequest, NextResponse } from "next/server";
import { getGame } from "@/lib/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  }
  const game = await getGame(id);
  if (!game) {
    return NextResponse.json({ error: "Partida não encontrada" }, { status: 404 });
  }
  return NextResponse.json(game);
}
