import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Diagnóstico rápido: mostra se o Redis está configurado no ambiente.
// Sem Redis, o multiplayer NÃO funciona em produção (serverless não
// compartilha memória entre instâncias).
export async function GET() {
  const hasRedis =
    !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
    !!(
      process.env.UPSTASH_REDIS_REST_URL &&
      process.env.UPSTASH_REDIS_REST_TOKEN
    );

  return NextResponse.json({
    ok: true,
    redis: hasRedis,
    storage: hasRedis ? "redis" : "memory (nao compartilha entre instancias)",
  });
}
