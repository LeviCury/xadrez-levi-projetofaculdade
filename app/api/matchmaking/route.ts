import { NextRequest, NextResponse } from "next/server";
import { joinQueue, leaveQueue, queueStatus } from "@/lib/matchmaking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Entra na fila
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = body?.playerId;
  const name = (body?.name ?? "").toString().trim() || "Anônimo";
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "playerId obrigatório" }, { status: 400 });
  }
  const result = await joinQueue({ id, name: name.slice(0, 24) });
  return NextResponse.json(result);
}

// Consulta status da fila (polling)
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("playerId");
  if (!id) {
    return NextResponse.json({ error: "playerId obrigatório" }, { status: 400 });
  }
  const result = await queueStatus(id);
  return NextResponse.json(result);
}

// Sai da fila
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("playerId");
  if (!id) {
    return NextResponse.json({ error: "playerId obrigatório" }, { status: 400 });
  }
  await leaveQueue(id);
  return NextResponse.json({ ok: true });
}
