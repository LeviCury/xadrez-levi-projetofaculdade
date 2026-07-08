"use client";

import { Chess, type Square } from "chess.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Color = "white" | "black";
type GameStatus = "ongoing" | "checkmate" | "draw" | "resigned";

interface Player {
  id: string;
  name: string;
}
interface Game {
  id: string;
  fen: string;
  white: Player;
  black: Player;
  status: GameStatus;
  winner: Color | null;
  turn: Color;
  moves: string[];
}

const GLYPH: Record<string, string> = {
  k: "\u265A",
  q: "\u265B",
  r: "\u265C",
  b: "\u265D",
  n: "\u265E",
  p: "\u265F",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];

function getPlayerId(): string {
  return sessionStorage.getItem("xadrez:playerId") ?? "";
}

export default function GamePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const gameId = params.id;

  const [playerId, setPlayerId] = useState("");
  const [game, setGame] = useState<Game | null>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [error, setError] = useState("");
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [notFound, setNotFound] = useState(false);

  // instância do chess.js reconstruída a partir do fen atual
  const chess = useMemo(() => {
    const c = new Chess();
    if (game?.fen) {
      try {
        c.load(game.fen);
      } catch {
        /* ignora fen inválido */
      }
    }
    return c;
  }, [game?.fen]);

  useEffect(() => {
    setPlayerId(getPlayerId());
  }, []);

  const fetchGame = useCallback(async () => {
    try {
      const res = await fetch(`/api/game?id=${encodeURIComponent(gameId)}`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const data = (await res.json()) as Game;
      setGame(data);
    } catch {
      /* tenta de novo no próximo tick */
    }
  }, [gameId]);

  useEffect(() => {
    fetchGame();
    const t = setInterval(fetchGame, 1000);
    return () => clearInterval(t);
  }, [fetchGame]);

  const myColor: Color | null = useMemo(() => {
    if (!game || !playerId) return null;
    if (game.white.id === playerId) return "white";
    if (game.black.id === playerId) return "black";
    return null;
  }, [game, playerId]);

  const orientation: Color = myColor ?? "white";
  const isMyTurn = !!myColor && game?.turn === myColor && game?.status === "ongoing";

  // mapa square -> peça
  const boardMap = useMemo(() => {
    const map = new Map<string, { type: string; color: "w" | "b" }>();
    for (const row of chess.board()) {
      for (const cell of row) {
        if (cell) map.set(cell.square, { type: cell.type, color: cell.color });
      }
    }
    return map;
  }, [chess]);

  const legalTargets = useMemo(() => {
    if (!selected) return new Map<string, boolean>();
    const targets = new Map<string, boolean>();
    try {
      const moves = chess.moves({ square: selected, verbose: true });
      for (const m of moves) {
        const isCapture = m.flags.includes("c") || m.flags.includes("e");
        targets.set(m.to, isCapture);
      }
    } catch {
      /* peça sem movimentos */
    }
    return targets;
  }, [selected, chess]);

  const kingInCheck = useMemo(() => {
    if (!game || game.status !== "ongoing" || !chess.inCheck()) return null;
    const turnColor = chess.turn();
    for (const [sq, p] of boardMap) {
      if (p.type === "k" && p.color === turnColor) return sq;
    }
    return null;
  }, [chess, boardMap, game]);

  const sendMove = useCallback(
    async (from: Square, to: Square, promotion?: string) => {
      setError("");
      // aplica otimisticamente pra resposta imediata; o polling reconcilia
      const optimistic = new Chess();
      try {
        optimistic.load(chess.fen());
        optimistic.move({ from, to, promotion: (promotion as any) ?? "q" });
        setGame((g) =>
          g
            ? {
                ...g,
                fen: optimistic.fen(),
                turn: optimistic.turn() === "w" ? "white" : "black",
              }
            : g
        );
      } catch {
        /* se falhar local, deixa o servidor decidir */
      }

      try {
        const res = await fetch("/api/game/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameId, playerId, from, to, promotion }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setError(d.error ?? "Jogada rejeitada");
          fetchGame();
        } else {
          const updated = (await res.json()) as Game;
          setGame(updated);
        }
      } catch {
        setError("Falha de rede");
        fetchGame();
      }
    },
    [chess, gameId, playerId, fetchGame]
  );

  const onSquareClick = useCallback(
    (square: Square) => {
      if (!isMyTurn || !myColor) return;
      const piece = boardMap.get(square);
      const myCode = myColor === "white" ? "w" : "b";

      if (selected) {
        if (square === selected) {
          setSelected(null);
          return;
        }
        if (legalTargets.has(square)) {
          const movingPiece = boardMap.get(selected);
          const lastRank = myColor === "white" ? "8" : "1";
          if (movingPiece?.type === "p" && square[1] === lastRank) {
            setPromo({ from: selected, to: square });
          } else {
            sendMove(selected, square);
          }
          setSelected(null);
          return;
        }
        // clicou em outra peça própria -> reseleciona
        if (piece && piece.color === myCode) {
          setSelected(square);
          return;
        }
        setSelected(null);
        return;
      }

      // nenhuma seleção: só seleciona peça própria
      if (piece && piece.color === myCode) {
        setSelected(square);
      }
    },
    [isMyTurn, myColor, boardMap, selected, legalTargets, sendMove]
  );

  const doResign = useCallback(async () => {
    if (!confirm("Desistir da partida?")) return;
    await fetch("/api/game/resign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId, playerId }),
    }).catch(() => {});
    fetchGame();
  }, [gameId, playerId, fetchGame]);

  if (notFound) {
    return (
      <div className="wrap">
        <h1>Partida não encontrada</h1>
        <p className="muted">Ela pode ter expirado.</p>
        <button onClick={() => router.push("/")}>Voltar ao lobby</button>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="wrap">
        <p className="muted">Carregando partida…</p>
      </div>
    );
  }

  const opponent =
    myColor === "white" ? game.black : myColor === "black" ? game.white : null;

  const displayRanks = orientation === "white" ? RANKS : [...RANKS].reverse();
  const displayFiles = orientation === "white" ? FILES : [...FILES].reverse();

  const statusText = (() => {
    if (game.status === "checkmate") {
      const winnerIsMe = game.winner === myColor;
      return `Xeque-mate! ${
        game.winner === "white" ? "Brancas" : "Pretas"
      } venceram.${myColor ? (winnerIsMe ? " Você ganhou! 🎉" : " Você perdeu.") : ""}`;
    }
    if (game.status === "draw") return "Empate.";
    if (game.status === "resigned") {
      const winnerIsMe = game.winner === myColor;
      return `Desistência. ${
        game.winner === "white" ? "Brancas" : "Pretas"
      } venceram.${myColor ? (winnerIsMe ? " Você ganhou!" : " Você perdeu.") : ""}`;
    }
    if (isMyTurn) return "Sua vez de jogar.";
    if (myColor) return "Vez do oponente…";
    return "Você está assistindo.";
  })();

  return (
    <div className="wrap">
      <div className="spread" style={{ marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: "1.3rem" }}>♟️ Partida</h1>
          <div className="muted">
            {myColor ? (
              <>
                Você joga de{" "}
                <b>{myColor === "white" ? "brancas" : "pretas"}</b> vs{" "}
                <b>{opponent?.name ?? "?"}</b>
              </>
            ) : (
              "Modo espectador"
            )}
          </div>
        </div>
        <span className="badge">
          {game.white.name} (brancas) × {game.black.name} (pretas)
        </span>
      </div>

      <div className="status">{statusText}</div>
      <div className="err">{error}</div>

      <div className="board" style={{ margin: "12px 0" }}>
        {displayRanks.map((rank, r) =>
          displayFiles.map((file, f) => {
            const square = (file + rank) as Square;
            const isLight = (r + f) % 2 === 0;
            const piece = boardMap.get(square);
            const isSel = selected === square;
            const target = legalTargets.get(square);
            const isTarget = legalTargets.has(square);
            const isCheck = kingInCheck === square;
            const classes = [
              "sq",
              isLight ? "light" : "dark",
              isSel ? "selected" : "",
              target ? "capture" : "",
              isCheck ? "check" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div
                key={square}
                className={classes}
                onClick={() => onSquareClick(square)}
              >
                {piece && (
                  <span className={`piece ${piece.color}`}>
                    {GLYPH[piece.type]}
                  </span>
                )}
                {isTarget && <span className="dot" />}
              </div>
            );
          })
        )}
      </div>

      <div className="row">
        <button className="secondary" onClick={() => router.push("/")}>
          Voltar ao lobby
        </button>
        {game.status === "ongoing" && myColor && (
          <button className="danger" onClick={doResign}>
            Desistir
          </button>
        )}
      </div>

      {game.moves.length > 0 && (
        <p className="muted" style={{ marginTop: 16, fontSize: "0.85rem" }}>
          Lances: {game.moves.join("  ")}
        </p>
      )}

      {promo && (
        <div className="promo">
          <div className="card">
            <div>Promover para:</div>
            <div className="opts">
              {(["q", "r", "b", "n"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    sendMove(promo.from, promo.to, p);
                    setPromo(null);
                  }}
                >
                  <span className={`piece ${myColor === "white" ? "w" : "b"}`}>
                    {GLYPH[p]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
