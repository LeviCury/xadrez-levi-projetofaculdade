import { Chess } from "chess.js";
import { getStore } from "./store";
import type { Game, MatchResult, Player } from "./types";

// tempo máximo sem "sinal de vida" antes de considerar um jogador da fila fantasma
const STALE_MS = 8000;

function newId(): string {
  // randomUUID existe no runtime Node do Vercel e no dev local
  return (globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36)) as string;
}

function createGame(white: Player, black: Player): Game {
  const chess = new Chess();
  const now = Date.now();
  return {
    id: newId(),
    fen: chess.fen(),
    white,
    black,
    status: "ongoing",
    winner: null,
    turn: "white",
    moves: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Entra na fila. Se já houver alguém esperando, cria a partida na hora.
 * Caso contrário, entra na fila e fica "waiting" (o cliente faz polling do status).
 */
export async function joinQueue(player: Player): Promise<MatchResult> {
  const store = getStore();

  // guarda o nome e marca presença
  await store.setName(player.id, player.name);
  await store.setSeen(player.id);

  // Já tem uma partida? Só reconecta se ela ainda estiver em andamento.
  // Se acabou (ou sumiu), limpa o vínculo e entra numa fila nova — senão o
  // jogador ficaria preso voltando pra partida encerrada.
  const existing = await store.getMatch(player.id);
  if (existing) {
    const g = await store.getGame(existing.gameId);
    if (g && g.status === "ongoing") {
      return {
        status: "matched",
        gameId: existing.gameId,
        color: existing.color,
      };
    }
    await store.clearMatch(player.id);
  }

  // Tenta achar um oponente vivo na fila, descartando entradas fantasmas
  // (gente que entrou e fechou a aba sem cancelar).
  let opponentId: string | null = null;
  const now = Date.now();
  for (let i = 0; i < 50; i++) {
    const candidate = await store.queuePop();
    if (!candidate) break;
    if (candidate === player.id) continue; // não parear consigo mesmo
    const seen = await store.getSeen(candidate);
    if (seen == null || now - seen > STALE_MS) continue; // fantasma: descarta
    opponentId = candidate;
    break;
  }

  if (!opponentId) {
    // ninguém esperando — entra na fila
    await store.queuePush(player.id);
    return { status: "waiting" };
  }

  // achou oponente: quem já estava esperando joga de brancas
  const opponentName = (await store.getName(opponentId)) ?? "Anônimo";
  const opponent: Player = { id: opponentId, name: opponentName };
  const game = createGame(opponent, player);

  await store.saveGame(game);
  await store.setMatch(opponent.id, { gameId: game.id, color: "white" });
  await store.setMatch(player.id, { gameId: game.id, color: "black" });

  return { status: "matched", gameId: game.id, color: "black" };
}

export async function queueStatus(playerId: string): Promise<MatchResult> {
  const store = getStore();
  // cada polling do cliente conta como sinal de vida
  await store.setSeen(playerId);
  const match = await store.getMatch(playerId);
  if (match) {
    const g = await store.getGame(match.gameId);
    if (g && g.status === "ongoing") {
      return { status: "matched", gameId: match.gameId, color: match.color };
    }
    // vínculo obsoleto (partida acabou): descarta e continua esperando
    await store.clearMatch(playerId);
  }
  return { status: "waiting" };
}

export async function leaveQueue(playerId: string): Promise<void> {
  await getStore().queueRemove(playerId);
}
