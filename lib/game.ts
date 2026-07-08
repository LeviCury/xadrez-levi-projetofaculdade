import { Chess } from "chess.js";
import { getStore } from "./store";
import type { Color, Game } from "./types";

export async function getGame(id: string): Promise<Game | null> {
  return getStore().getGame(id);
}

function colorOf(game: Game, playerId: string): Color | null {
  if (game.white.id === playerId) return "white";
  if (game.black.id === playerId) return "black";
  return null;
}

interface MoveInput {
  gameId: string;
  playerId: string;
  from: string;
  to: string;
  promotion?: string;
}

interface MoveResult {
  ok: boolean;
  error?: string;
  game?: Game;
}

export async function applyMove(input: MoveInput): Promise<MoveResult> {
  const store = getStore();
  const game = await store.getGame(input.gameId);
  if (!game) return { ok: false, error: "Partida não encontrada." };
  if (game.status !== "ongoing")
    return { ok: false, error: "A partida já terminou.", game };

  const myColor = colorOf(game, input.playerId);
  if (!myColor) return { ok: false, error: "Você não faz parte desta partida." };
  if (myColor !== game.turn)
    return { ok: false, error: "Não é a sua vez.", game };

  const chess = new Chess();
  try {
    chess.load(game.fen);
  } catch {
    return { ok: false, error: "Estado da partida corrompido." };
  }

  let move;
  try {
    move = chess.move({
      from: input.from,
      to: input.to,
      promotion: (input.promotion as "q" | "r" | "b" | "n" | undefined) ?? "q",
    });
  } catch {
    move = null;
  }
  if (!move) return { ok: false, error: "Jogada ilegal.", game };

  game.fen = chess.fen();
  game.moves.push(move.san);
  game.turn = chess.turn() === "w" ? "white" : "black";
  game.updatedAt = Date.now();

  if (chess.isCheckmate()) {
    game.status = "checkmate";
    // quem acabou de mover venceu
    game.winner = myColor;
  } else if (chess.isDraw() || chess.isStalemate() || chess.isInsufficientMaterial() || chess.isThreefoldRepetition()) {
    game.status = "draw";
    game.winner = null;
  }

  await store.saveGame(game);
  return { ok: true, game };
}

export async function resign(
  gameId: string,
  playerId: string
): Promise<MoveResult> {
  const store = getStore();
  const game = await store.getGame(gameId);
  if (!game) return { ok: false, error: "Partida não encontrada." };
  const myColor = colorOf(game, playerId);
  if (!myColor) return { ok: false, error: "Você não faz parte desta partida." };
  if (game.status !== "ongoing") return { ok: true, game };

  game.status = "resigned";
  game.winner = myColor === "white" ? "black" : "white";
  game.updatedAt = Date.now();
  await store.saveGame(game);
  return { ok: true, game };
}
