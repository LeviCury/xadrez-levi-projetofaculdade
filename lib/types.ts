export type Color = "white" | "black";

export type GameStatus = "ongoing" | "checkmate" | "draw" | "resigned";

export interface Player {
  id: string;
  name: string;
}

export interface Game {
  id: string;
  fen: string;
  white: Player;
  black: Player;
  status: GameStatus;
  // vencedor: cor de quem ganhou (checkmate/resign) ou null (em andamento/empate)
  winner: Color | null;
  turn: Color;
  moves: string[];
  createdAt: number;
  updatedAt: number;
}

export interface MatchResult {
  status: "waiting" | "matched";
  gameId?: string;
  color?: Color;
}
