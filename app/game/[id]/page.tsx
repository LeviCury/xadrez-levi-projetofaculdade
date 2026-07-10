"use client";

import { Chess, type Square } from "chess.js";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";

const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

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
  createdAt: number;
  updatedAt: number;
}

// Glyphs "cheios" (pretos) + seletor de apresentação de texto (\uFE0E) pra
// impedir que o celular renderize como emoji (o que ignora a cor do CSS e
// deixava os peões brancos aparecendo pretos).
const GLYPH: Record<string, string> = {
  k: "\u265A",
  q: "\u265B",
  r: "\u265C",
  b: "\u265D",
  n: "\u265E",
  p: "\u265F",
};
const pieceChar = (type: string) => GLYPH[type] + "\uFE0E";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];

function getPlayerId(): string {
  return sessionStorage.getItem("xadrez:playerId") ?? "";
}

interface DragState {
  from: Square;
  type: string;
  color: "w" | "b";
  x: number;
  y: number;
}

interface MoveDetail {
  from: Square;
  to: Square;
  color: "w" | "b";
  piece: string;
  captured?: string;
  promotion?: string;
  flags: string;
  san: string;
}

interface CaptureSummary {
  pieces: string[];
  score: number;
}

interface PlayerBarProps {
  player: Player;
  color: Color;
  isMe: boolean;
  isTurn: boolean;
  captures: CaptureSummary;
  materialAdvantage: number;
}

interface SnapshotVersion {
  updatedAt: number;
  ply: number;
  terminal: boolean;
}

const PIECE_VALUE: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

const PIECE_ORDER: Record<string, number> = {
  q: 0,
  r: 1,
  b: 2,
  n: 3,
  p: 4,
  k: 5,
};

const PIECE_NAME: Record<string, string> = {
  p: "Peão",
  n: "Cavalo",
  b: "Bispo",
  r: "Torre",
  q: "Dama",
  k: "Rei",
};

function replayMoves(moves: string[]): MoveDetail[] {
  const replay = new Chess();
  const details: MoveDetail[] = [];

  for (const san of moves) {
    try {
      const move = replay.move(san);
      if (!move) break;
      details.push({
        from: move.from as Square,
        to: move.to as Square,
        color: move.color,
        piece: move.piece,
        captured: move.captured,
        promotion: move.promotion,
        flags: move.flags,
        san: move.san,
      });
    } catch {
      // Um histórico antigo/corrompido não deve impedir o tabuleiro de abrir.
      break;
    }
  }

  return details;
}

function summarizeCaptures(
  moves: MoveDetail[]
): Record<Color, CaptureSummary> {
  const pieces: Record<Color, string[]> = { white: [], black: [] };

  for (const move of moves) {
    if (!move.captured) continue;
    pieces[move.color === "w" ? "white" : "black"].push(move.captured);
  }

  const summary = (captured: string[]): CaptureSummary => {
    const sorted = [...captured].sort(
      (a, b) => (PIECE_ORDER[a] ?? 99) - (PIECE_ORDER[b] ?? 99)
    );
    return {
      pieces: sorted,
      score: sorted.reduce((total, piece) => total + (PIECE_VALUE[piece] ?? 0), 0),
    };
  };

  return {
    white: summary(pieces.white),
    black: summary(pieces.black),
  };
}

function squarePosition(square: Square, orientation: Color) {
  const whiteColumn = FILES.indexOf(square[0]);
  const whiteRow = RANKS.indexOf(square[1]);
  return orientation === "white"
    ? { column: whiteColumn, row: whiteRow }
    : { column: 7 - whiteColumn, row: 7 - whiteRow };
}

function castlingRookMove(move: MoveDetail | null): MoveDetail | null {
  if (!move || (!move.flags.includes("k") && !move.flags.includes("q"))) {
    return null;
  }

  const rank = move.color === "w" ? "1" : "8";
  const kingSide = move.flags.includes("k");
  return {
    from: `${kingSide ? "h" : "a"}${rank}` as Square,
    to: `${kingSide ? "f" : "d"}${rank}` as Square,
    color: move.color,
    piece: "r",
    flags: move.flags,
    san: move.san,
  };
}

function movingPieceStyle(
  move: Pick<MoveDetail, "from" | "to">,
  orientation: Color
): CSSProperties {
  const from = squarePosition(move.from, orientation);
  const to = squarePosition(move.to, orientation);
  return {
    left: `${to.column * 12.5}%`,
    top: `${to.row * 12.5}%`,
    "--move-x": `${(from.column - to.column) * 100}%`,
    "--move-y": `${(from.row - to.row) * 100}%`,
  } as CSSProperties;
}

function snapshotVersion(game: Game): SnapshotVersion {
  return {
    updatedAt: game.updatedAt,
    ply: game.moves.length,
    terminal: game.status !== "ongoing",
  };
}

function compareSnapshots(a: SnapshotVersion, b: SnapshotVersion): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
  if (a.ply !== b.ply) return a.ply - b.ply;
  return Number(a.terminal) - Number(b.terminal);
}

function PlayerBar({
  player,
  color,
  isMe,
  isTurn,
  captures,
  materialAdvantage,
}: PlayerBarProps) {
  const pieceColor = color === "white" ? "w" : "b";
  const capturedPieceColor = color === "white" ? "b" : "w";

  return (
    <div className={`player-bar ${isTurn ? "active" : ""}`}>
      <div className={`player-avatar ${pieceColor}`} aria-hidden="true">
        <span className={`piece ${pieceColor}`}>{pieceChar("k")}</span>
      </div>

      <div className="player-info">
        <div className="player-name-row">
          <strong>{player.name}</strong>
          {isMe && <span className="you-label">você</span>}
          <span className="color-label">
            {color === "white" ? "Brancas" : "Pretas"}
          </span>
          {isTurn && <span className="turn-pulse" title="Vez de jogar" />}
        </div>

        <div
          className="captured-pieces"
          aria-label={`Peças capturadas por ${player.name}`}
        >
          {captures.pieces.length ? (
            captures.pieces.map((piece, index) => (
              <span
                className={`captured-piece piece ${capturedPieceColor}`}
                key={`${piece}-${index}`}
                title={`${PIECE_NAME[piece] ?? "Peça"} capturado(a)`}
              >
                {pieceChar(piece)}
              </span>
            ))
          ) : (
            <span className="no-captures">Nenhuma captura</span>
          )}
        </div>
      </div>

      <div className="material-score" title="Pontos de material capturado">
        <strong>{captures.score}</strong>
        <span>pts</span>
        {materialAdvantage > 0 && (
          <small title="Vantagem material atual">+{materialAdvantage}</small>
        )}
      </div>
    </div>
  );
}

export default function GamePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const gameId = params.id;

  const [playerId, setPlayerId] = useState("");
  const [game, setGame] = useState<Game | null>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [error, setError] = useState("");
  const [promo, setPromo] = useState<{
    from: Square;
    to: Square;
    animateSlide: boolean;
  } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [moveAnimation, setMoveAnimation] = useState<{
    ply: number;
    slide: boolean;
  } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const moveListRef = useRef<HTMLDivElement>(null);
  const knownPlyRef = useRef<number | null>(null);
  const latestServerVersionRef = useRef<SnapshotVersion | null>(null);
  const pendingMoveRef = useRef<{ ply: number; requestId: number } | null>(
    null
  );
  const moveRequestIdRef = useRef(0);
  const animationModeRef = useRef(new Map<number, boolean>());
  const activeGameIdRef = useRef(gameId);
  activeGameIdRef.current = gameId;

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

  useEffect(() => {
    knownPlyRef.current = null;
    latestServerVersionRef.current = null;
    pendingMoveRef.current = null;
    moveRequestIdRef.current += 1;
    animationModeRef.current.clear();
    setMoveAnimation(null);
    setGame(null);
    setNotFound(false);
    setSelected(null);
    setError("");
  }, [gameId]);

  const applyServerSnapshot = useCallback((data: Game) => {
    if (data.id !== activeGameIdRef.current) return false;

    const incomingVersion = snapshotVersion(data);
    const latestVersion = latestServerVersionRef.current;
    const versionComparison = latestVersion
      ? compareSnapshots(incomingVersion, latestVersion)
      : 1;

    // GETs e POSTs podem terminar fora de ordem. updatedAt + número de
    // lances formam uma versão monotônica e impedem o tabuleiro de regredir.
    if (versionComparison < 0) return false;

    const pending = pendingMoveRef.current;
    if (pending && data.moves.length < pending.ply) {
      // Um snapshot igual é apenas polling atrasado. Um snapshot realmente
      // mais novo (por exemplo, desistência do oponente) vence o otimista.
      if (versionComparison <= 0) return false;
      pendingMoveRef.current = null;
      if (moveRequestIdRef.current === pending.requestId) {
        moveRequestIdRef.current += 1;
      }
      animationModeRef.current.delete(pending.ply);
      setMoveAnimation(null);
    }

    latestServerVersionRef.current = incomingVersion;
    if (pending && data.moves.length >= pending.ply) {
      pendingMoveRef.current = null;
    }
    setNotFound(false);
    setGame(data);
    return true;
  }, []);

  const fetchGame = useCallback(async () => {
    try {
      const res = await fetch(`/api/game?id=${encodeURIComponent(gameId)}`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        if (activeGameIdRef.current !== gameId) return;
        setNotFound(true);
        return;
      }
      const data = (await res.json()) as Game;
      applyServerSnapshot(data);
    } catch {
      /* tenta de novo no próximo tick */
    }
  }, [applyServerSnapshot, gameId]);

  useEffect(() => {
    fetchGame();
    const t = setInterval(fetchGame, 1000);
    return () => clearInterval(t);
  }, [fetchGame]);

  useClientLayoutEffect(() => {
    if (!game) return;
    const ply = game.moves.length;
    const knownPly = knownPlyRef.current;

    if (knownPly === null) {
      knownPlyRef.current = ply;
      return;
    }

    if (ply < knownPly) {
      // Rollback de uma atualização otimista rejeitada pelo servidor.
      knownPlyRef.current = ply;
      setMoveAnimation(null);
      for (const animatedPly of animationModeRef.current.keys()) {
        if (animatedPly > ply) animationModeRef.current.delete(animatedPly);
      }
      return;
    }

    if (ply === knownPly) return;

    const slide = animationModeRef.current.get(ply) ?? true;
    animationModeRef.current.delete(ply);
    knownPlyRef.current = ply;
    setMoveAnimation({ ply, slide });

    const timer = window.setTimeout(() => {
      setMoveAnimation((current) => (current?.ply === ply ? null : current));
    }, 360);
    return () => window.clearTimeout(timer);
  }, [game?.moves.length]);

  useEffect(() => {
    const list = moveListRef.current;
    if (!list || !game?.moves.length) return;
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [game?.moves.length]);

  const myColor: Color | null = useMemo(() => {
    if (!game || !playerId) return null;
    if (game.white.id === playerId) return "white";
    if (game.black.id === playerId) return "black";
    return null;
  }, [game, playerId]);

  const orientation: Color = myColor ?? "white";
  const isMyTurn =
    !!myColor && game?.turn === myColor && game?.status === "ongoing";
  const myCode = myColor === "white" ? "w" : "b";

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

  const moveDetails = useMemo(
    () => replayMoves(game?.moves ?? []),
    [game?.moves]
  );
  const lastMove = moveDetails.at(-1) ?? null;
  const captures = useMemo(
    () => summarizeCaptures(moveDetails),
    [moveDetails]
  );
  const materialAdvantage = useMemo(() => {
    const material = { white: 0, black: 0 };
    for (const piece of boardMap.values()) {
      const color = piece.color === "w" ? "white" : "black";
      material[color] += PIECE_VALUE[piece.type] ?? 0;
    }
    return {
      white: Math.max(0, material.white - material.black),
      black: Math.max(0, material.black - material.white),
    };
  }, [boardMap]);

  const legalFrom = useCallback(
    (from: Square) => {
      const targets = new Map<string, boolean>();
      try {
        for (const m of chess.moves({ square: from, verbose: true })) {
          targets.set(m.to, m.flags.includes("c") || m.flags.includes("e"));
        }
      } catch {
        /* peça sem movimentos */
      }
      return targets;
    },
    [chess]
  );

  const legalTargets = useMemo(
    () => (selected ? legalFrom(selected) : new Map<string, boolean>()),
    [selected, legalFrom]
  );

  const kingInCheck = useMemo(() => {
    if (!game || game.status !== "ongoing" || !chess.inCheck()) return null;
    const turnColor = chess.turn();
    for (const [sq, p] of boardMap) {
      if (p.type === "k" && p.color === turnColor) return sq;
    }
    return null;
  }, [chess, boardMap, game]);

  const sendMove = useCallback(
    async (
      from: Square,
      to: Square,
      promotion?: string,
      animateSlide = true
    ) => {
      setError("");
      // aplica otimisticamente pra resposta imediata; o polling reconcilia
      const optimistic = new Chess();
      const expectedPly = (game?.moves.length ?? 0) + 1;
      const requestId = ++moveRequestIdRef.current;
      let optimisticMove:
        | {
            fen: string;
            san: string;
            turn: Color;
            status: GameStatus;
            winner: Color | null;
          }
        | undefined;

      try {
        optimistic.load(chess.fen());
        const move = optimistic.move({
          from,
          to,
          promotion: (promotion as "q" | "r" | "b" | "n" | undefined) ?? "q",
        });

        if (move) {
          const isCheckmate = optimistic.isCheckmate();
          const isDraw =
            optimistic.isDraw() ||
            optimistic.isStalemate() ||
            optimistic.isInsufficientMaterial() ||
            optimistic.isThreefoldRepetition();
          optimisticMove = {
            fen: optimistic.fen(),
            san: move.san,
            turn: optimistic.turn() === "w" ? "white" : "black",
            status: isCheckmate ? "checkmate" : isDraw ? "draw" : "ongoing",
            winner: isCheckmate ? myColor : null,
          };

          pendingMoveRef.current = { ply: expectedPly, requestId };
          animationModeRef.current.set(expectedPly, animateSlide);
          setGame((current) => {
            if (!current || current.moves.length >= expectedPly) return current;
            return {
              ...current,
              fen: optimisticMove!.fen,
              moves: [...current.moves, optimisticMove!.san],
              turn: optimisticMove!.turn,
              status: optimisticMove!.status,
              winner: optimisticMove!.winner,
            };
          });
        }
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
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            game?: Game;
          };
          if (moveRequestIdRef.current !== requestId) {
            if (data.game) applyServerSnapshot(data.game);
            return;
          }

          setError(data.error ?? "Jogada rejeitada");
          if (pendingMoveRef.current?.requestId === requestId) {
            pendingMoveRef.current = null;
          }
          animationModeRef.current.delete(expectedPly);
          setMoveAnimation(null);
          if (data.game) applyServerSnapshot(data.game);
          else fetchGame();
        } else {
          const updated = (await res.json()) as Game;
          applyServerSnapshot(updated);
        }
      } catch {
        if (moveRequestIdRef.current !== requestId) return;
        setError("Falha de rede");
        if (pendingMoveRef.current?.requestId === requestId) {
          pendingMoveRef.current = null;
        }
        animationModeRef.current.delete(expectedPly);
        setMoveAnimation(null);
        fetchGame();
      }
    },
    [
      applyServerSnapshot,
      chess,
      game?.moves.length,
      gameId,
      myColor,
      playerId,
      fetchGame,
    ]
  );

  // executa a jogada, tratando promoção de peão
  const doMove = useCallback(
    (from: Square, to: Square, animateSlide = true) => {
      const piece = boardMap.get(from);
      const lastRank = piece?.color === "w" ? "8" : "1";
      if (piece?.type === "p" && to[1] === lastRank) {
        setPromo({ from, to, animateSlide });
      } else {
        sendMove(from, to, undefined, animateSlide);
      }
      setSelected(null);
    },
    [boardMap, sendMove]
  );

  // clique/toque simples (sem arrastar)
  const tapSquare = useCallback(
    (square: Square) => {
      if (!isMyTurn || !myColor) return;
      const piece = boardMap.get(square);

      if (selected) {
        if (square === selected) {
          setSelected(null);
          return;
        }
        if (legalFrom(selected).has(square)) {
          doMove(selected, square);
          return;
        }
        if (piece && piece.color === myCode) {
          setSelected(square);
          return;
        }
        setSelected(null);
        return;
      }
      if (piece && piece.color === myCode) setSelected(square);
    },
    [isMyTurn, myColor, myCode, boardMap, selected, legalFrom, doMove]
  );

  const onPointerDown = useCallback(
    (square: Square, e: React.PointerEvent) => {
      if (!isMyTurn || !myColor) return;
      const piece = boardMap.get(square);
      if (piece && piece.color === myCode) {
        // começa um arraste a partir da peça própria
        e.preventDefault();
        setSelected(square);
        setDrag({
          from: square,
          type: piece.type,
          color: piece.color,
          x: e.clientX,
          y: e.clientY,
        });
        boardRef.current?.setPointerCapture(e.pointerId);
      } else {
        // clique num destino/vazio
        tapSquare(square);
      }
    },
    [isMyTurn, myColor, myCode, boardMap, tapSquare]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    },
    [drag]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      const from = drag.from;
      setDrag(null);
      try {
        boardRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const el = document.elementFromPoint(
        e.clientX,
        e.clientY
      ) as HTMLElement | null;
      const targetSq = el
        ?.closest("[data-square]")
        ?.getAttribute("data-square") as Square | null;

      if (!targetSq || targetSq === from) return; // foi um toque: mantém selecionado
      if (legalFrom(from).has(targetSq)) {
        // A peça já acompanhou o ponteiro; no destino basta o efeito de pouso.
        doMove(from, targetSq, false);
        return;
      }
      const tp = boardMap.get(targetSq);
      if (tp && tp.color === myCode) setSelected(targetSq); // reseleciona
      else setSelected(null);
    },
    [drag, legalFrom, doMove, boardMap, myCode]
  );

  const doResign = useCallback(async () => {
    if (!confirm("Desistir da partida?")) return;
    moveRequestIdRef.current += 1;
    pendingMoveRef.current = null;
    animationModeRef.current.clear();
    setMoveAnimation(null);

    try {
      const response = await fetch("/api/game/resign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, playerId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Não foi possível desistir.");
        fetchGame();
        return;
      }
      applyServerSnapshot((await response.json()) as Game);
    } catch {
      setError("Falha de rede");
      fetchGame();
    }
  }, [applyServerSnapshot, gameId, playerId, fetchGame]);

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
  const topColor: Color = orientation === "white" ? "black" : "white";
  const bottomColor: Color = orientation === "white" ? "white" : "black";
  const topPlayer = topColor === "white" ? game.white : game.black;
  const bottomPlayer = bottomColor === "white" ? game.white : game.black;
  const moveRows = Array.from(
    { length: Math.ceil(game.moves.length / 2) },
    (_, index) => ({
      number: index + 1,
      white: game.moves[index * 2],
      black: game.moves[index * 2 + 1],
    })
  );

  const animatedMove =
    moveAnimation?.ply === game.moves.length ? lastMove : null;
  const animatedRookMove = castlingRookMove(animatedMove);
  const moveAnimationStyle =
    animatedMove && moveAnimation?.slide
      ? movingPieceStyle(animatedMove, orientation)
      : undefined;
  const rookAnimationStyle = animatedRookMove
    ? movingPieceStyle(animatedRookMove, orientation)
    : undefined;

  const statusText = (() => {
    if (game.status === "checkmate") {
      const winnerIsMe = game.winner === myColor;
      return `Xeque-mate! ${
        game.winner === "white" ? "Brancas" : "Pretas"
      } venceram.${
        myColor ? (winnerIsMe ? " Você ganhou! 🎉" : " Você perdeu.") : ""
      }`;
    }
    if (game.status === "draw") return "Empate.";
    if (game.status === "resigned") {
      const winnerIsMe = game.winner === myColor;
      return `Desistência. ${
        game.winner === "white" ? "Brancas" : "Pretas"
      } venceram.${
        myColor ? (winnerIsMe ? " Você ganhou!" : " Você perdeu.") : ""
      }`;
    }
    if (isMyTurn) {
      return chess.inCheck()
        ? "Seu rei está em xeque — encontre uma saída."
        : "Sua vez de jogar.";
    }
    if (myColor) {
      return chess.inCheck() ? "Xeque no oponente." : "Vez do oponente…";
    }
    return "Você está assistindo.";
  })();

  const statusTone = (() => {
    if (game.status === "draw") return "neutral";
    if (game.status !== "ongoing") {
      if (!myColor) return "neutral";
      return game.winner === myColor ? "win" : "loss";
    }
    return isMyTurn ? "turn" : "waiting";
  })();

  const statusLabel =
    game.status === "ongoing"
      ? chess.inCheck()
        ? "Xeque"
        : "Partida em andamento"
      : "Partida encerrada";

  const statusIcon =
    game.status === "checkmate"
      ? "♛"
      : game.status === "draw"
        ? "½"
        : game.status === "resigned"
          ? "⚑"
          : chess.inCheck()
            ? "!"
            : isMyTurn
              ? "●"
              : "○";

  return (
    <div className="wrap game-page">
      <header className="game-header">
        <div>
          <span className="eyebrow">Xadrez da equipe</span>
          <h1>Partida ao vivo</h1>
          <p className="game-subtitle">
            {myColor ? (
              <>
                Você joga de{" "}
                <strong>{myColor === "white" ? "brancas" : "pretas"}</strong>{" "}
                contra <strong>{opponent?.name ?? "?"}</strong>
              </>
            ) : (
              "Modo espectador"
            )}
          </p>
        </div>
        <span className="game-id" title={game.id}>
          Sala #{game.id.slice(0, 8)}
        </span>
      </header>

      {error && (
        <div className="game-error" role="alert">
          {error}
        </div>
      )}

      <div className="game-layout">
        <main className="board-column">
          <PlayerBar
            player={topPlayer}
            color={topColor}
            isMe={myColor === topColor}
            isTurn={game.status === "ongoing" && game.turn === topColor}
            captures={captures[topColor]}
            materialAdvantage={materialAdvantage[topColor]}
          />

          <div
            className={`board ${isMyTurn ? "interactive" : ""}`}
            ref={boardRef}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label="Tabuleiro de xadrez"
          >
            {displayRanks.map((rank, r) =>
              displayFiles.map((file, f) => {
                const square = (file + rank) as Square;
                const isLight = (r + f) % 2 === 0;
                const piece = boardMap.get(square);
                const isSel = selected === square;
                const target = legalTargets.get(square);
                const isTarget = legalTargets.has(square);
                const isCheck = kingInCheck === square;
                const isDragging = drag?.from === square;
                const isLastFrom = lastMove?.from === square;
                const isLastTo = lastMove?.to === square;
                const isAnimationTarget = animatedMove?.to === square;
                const isRookAnimationTarget =
                  animatedRookMove?.to === square;
                const classes = [
                  "sq",
                  isLight ? "light" : "dark",
                  isSel ? "selected" : "",
                  target ? "capture" : "",
                  isCheck ? "check" : "",
                  isLastFrom ? "last-move last-move-from" : "",
                  isLastTo ? "last-move last-move-to" : "",
                  isAnimationTarget && moveAnimation?.slide
                    ? "move-target-animating"
                    : "",
                  isAnimationTarget && !moveAnimation?.slide
                    ? "move-target-settling"
                    : "",
                  isRookAnimationTarget ? "move-target-animating" : "",
                  isAnimationTarget && animatedMove?.captured
                    ? "capture-landing"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                const pieceDescription = piece
                  ? `${PIECE_NAME[piece.type] ?? "Peça"} ${
                      piece.color === "w" ? "branca" : "preta"
                    }`
                  : "casa vazia";

                return (
                  <div
                    key={square}
                    data-square={square}
                    className={classes}
                    onPointerDown={(event) => onPointerDown(square, event)}
                    aria-label={`${square}: ${pieceDescription}`}
                  >
                    {piece && (
                      <span
                        key={`${square}-${isLastTo ? game.moves.length : "piece"}-${piece.color}${piece.type}`}
                        className={`piece ${piece.color}`}
                        style={isDragging ? { opacity: 0.25 } : undefined}
                      >
                        {pieceChar(piece.type)}
                      </span>
                    )}
                    {isTarget && <span className="dot" />}
                    {f === 0 && (
                      <span className="board-coordinate rank-coordinate">
                        {rank}
                      </span>
                    )}
                    {r === 7 && (
                      <span className="board-coordinate file-coordinate">
                        {file}
                      </span>
                    )}
                  </div>
                );
              })
            )}

            {animatedMove &&
              moveAnimation?.slide &&
              moveAnimationStyle && (
                <span
                  className="move-animation"
                  style={moveAnimationStyle}
                  aria-hidden="true"
                >
                  <span className={`piece ${animatedMove.color}`}>
                    {pieceChar(animatedMove.piece)}
                  </span>
                </span>
              )}

            {animatedRookMove && rookAnimationStyle && (
              <span
                className="move-animation"
                style={rookAnimationStyle}
                aria-hidden="true"
              >
                <span className={`piece ${animatedRookMove.color}`}>
                  {pieceChar("r")}
                </span>
              </span>
            )}
          </div>

          <PlayerBar
            player={bottomPlayer}
            color={bottomColor}
            isMe={myColor === bottomColor}
            isTurn={game.status === "ongoing" && game.turn === bottomColor}
            captures={captures[bottomColor]}
            materialAdvantage={materialAdvantage[bottomColor]}
          />
        </main>

        <aside className="game-sidebar">
          <section className={`game-status-card ${statusTone}`}>
            <span className="status-icon" aria-hidden="true">
              {statusIcon}
            </span>
            <div>
              <span>{statusLabel}</span>
              <strong>{statusText}</strong>
            </div>
          </section>

          <section className="moves-panel">
            <div className="moves-header">
              <div>
                <span>Histórico</span>
                <strong>Jogadas</strong>
              </div>
              <span className="moves-count">{game.moves.length} lances</span>
            </div>

            <div className="moves-list" ref={moveListRef}>
              {moveRows.length ? (
                moveRows.map((row, index) => {
                  const whitePly = index * 2 + 1;
                  const blackPly = index * 2 + 2;
                  return (
                    <div className="move-row" key={row.number}>
                      <span className="move-number">{row.number}.</span>
                      <span
                        className={`move-san ${
                          whitePly === game.moves.length ? "latest" : ""
                        }`}
                      >
                        {row.white}
                      </span>
                      <span
                        className={`move-san ${
                          blackPly === game.moves.length ? "latest" : ""
                        }`}
                      >
                        {row.black ?? "—"}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="empty-moves">
                  <span>♙</span>
                  A primeira jogada aparecerá aqui.
                </div>
              )}
            </div>
          </section>

          <div className="game-actions">
            <button className="secondary" onClick={() => router.push("/")}>
              Voltar ao lobby
            </button>
            {game.status === "ongoing" && myColor && (
              <button className="danger" onClick={doResign}>
                Desistir
              </button>
            )}
          </div>
        </aside>
      </div>

      {drag && (
        <div className="drag-piece" style={{ left: drag.x, top: drag.y }}>
          <span className={`piece ${drag.color}`}>{pieceChar(drag.type)}</span>
        </div>
      )}

      {promo && (
        <div className="promo" role="dialog" aria-modal="true">
          <div className="card promotion-card">
            <span className="eyebrow">Promoção</span>
            <strong>Escolha uma peça</strong>
            <div className="opts">
              {(["q", "r", "b", "n"] as const).map((p) => (
                <button
                  key={p}
                  aria-label={`Promover para ${PIECE_NAME[p]}`}
                  onClick={() => {
                    sendMove(
                      promo.from,
                      promo.to,
                      p,
                      promo.animateSlide
                    );
                    setPromo(null);
                  }}
                >
                  <span className={`piece ${myColor === "white" ? "w" : "b"}`}>
                    {pieceChar(p)}
                  </span>
                </button>
              ))}
            </div>
            <button className="secondary cancel-promotion" onClick={() => setPromo(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
