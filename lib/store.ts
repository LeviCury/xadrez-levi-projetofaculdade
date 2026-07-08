import { Redis } from "@upstash/redis";
import type { Game } from "./types";

/**
 * Camada de armazenamento.
 *
 * - Em produção (Vercel) usa Upstash Redis (variáveis KV_REST_API_URL / KV_REST_API_TOKEN
 *   ou UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).
 * - Em desenvolvimento local, se não houver Redis configurado, cai num store em memória
 *   (funciona porque `next dev` roda num único processo). Isso NÃO serve pra produção
 *   serverless, por isso o deploy precisa do Redis.
 */

const QUEUE_KEY = "xadrez:queue";
const gameKey = (id: string) => `xadrez:game:${id}`;
const matchKey = (playerId: string) => `xadrez:match:${playerId}`;
const nameKey = (playerId: string) => `xadrez:name:${playerId}`;
const seenKey = (playerId: string) => `xadrez:seen:${playerId}`;

interface StoredMatch {
  gameId: string;
  color: "white" | "black";
}

interface StoreBackend {
  // fila
  queuePop(): Promise<string | null>;
  queuePush(playerId: string): Promise<void>;
  queueRemove(playerId: string): Promise<void>;
  // pareamento (playerId -> partida)
  setMatch(playerId: string, match: StoredMatch): Promise<void>;
  getMatch(playerId: string): Promise<StoredMatch | null>;
  // nome do jogador (playerId -> nome)
  setName(playerId: string, name: string): Promise<void>;
  getName(playerId: string): Promise<string | null>;
  // heartbeat (playerId -> timestamp do último sinal de vida)
  setSeen(playerId: string): Promise<void>;
  getSeen(playerId: string): Promise<number | null>;
  // partidas
  saveGame(game: Game): Promise<void>;
  getGame(id: string): Promise<Game | null>;
}

/* -------------------------------------------------------------------------- */
/*                              Backend: Redis                                */
/* -------------------------------------------------------------------------- */

function getRedisEnv(): { url: string; token: string } | null {
  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  if (url && token) return { url, token };
  return null;
}

class RedisBackend implements StoreBackend {
  private redis: Redis;
  private ttl = 60 * 60 * 24; // 1 dia

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }

  async queuePop(): Promise<string | null> {
    const v = await this.redis.lpop<string>(QUEUE_KEY);
    return v ?? null;
  }

  async queuePush(playerId: string): Promise<void> {
    // evita duplicatas
    await this.redis.lrem(QUEUE_KEY, 0, playerId);
    await this.redis.rpush(QUEUE_KEY, playerId);
  }

  async queueRemove(playerId: string): Promise<void> {
    await this.redis.lrem(QUEUE_KEY, 0, playerId);
  }

  async setMatch(playerId: string, match: StoredMatch): Promise<void> {
    await this.redis.set(matchKey(playerId), match, { ex: this.ttl });
  }

  async getMatch(playerId: string): Promise<StoredMatch | null> {
    return (await this.redis.get<StoredMatch>(matchKey(playerId))) ?? null;
  }

  async setName(playerId: string, name: string): Promise<void> {
    await this.redis.set(nameKey(playerId), name, { ex: this.ttl });
  }

  async getName(playerId: string): Promise<string | null> {
    return (await this.redis.get<string>(nameKey(playerId))) ?? null;
  }

  async setSeen(playerId: string): Promise<void> {
    await this.redis.set(seenKey(playerId), Date.now(), { ex: 60 });
  }

  async getSeen(playerId: string): Promise<number | null> {
    return (await this.redis.get<number>(seenKey(playerId))) ?? null;
  }

  async saveGame(game: Game): Promise<void> {
    await this.redis.set(gameKey(game.id), game, { ex: this.ttl });
  }

  async getGame(id: string): Promise<Game | null> {
    return (await this.redis.get<Game>(gameKey(id))) ?? null;
  }
}

/* -------------------------------------------------------------------------- */
/*                          Backend: Memória (dev)                            */
/* -------------------------------------------------------------------------- */

// Mantém o estado entre hot-reloads do next dev usando globalThis.
const g = globalThis as unknown as {
  __xadrezMem?: {
    queue: string[];
    matches: Map<string, StoredMatch>;
    names: Map<string, string>;
    seen: Map<string, number>;
    games: Map<string, Game>;
  };
};

function mem() {
  if (!g.__xadrezMem) {
    g.__xadrezMem = {
      queue: [],
      matches: new Map(),
      names: new Map(),
      seen: new Map(),
      games: new Map(),
    };
  }
  return g.__xadrezMem;
}

class MemoryBackend implements StoreBackend {
  async queuePop(): Promise<string | null> {
    return mem().queue.shift() ?? null;
  }
  async queuePush(playerId: string): Promise<void> {
    const q = mem().queue;
    const i = q.indexOf(playerId);
    if (i >= 0) q.splice(i, 1);
    q.push(playerId);
  }
  async queueRemove(playerId: string): Promise<void> {
    const q = mem().queue;
    const i = q.indexOf(playerId);
    if (i >= 0) q.splice(i, 1);
  }
  async setMatch(playerId: string, match: StoredMatch): Promise<void> {
    mem().matches.set(playerId, match);
  }
  async getMatch(playerId: string): Promise<StoredMatch | null> {
    return mem().matches.get(playerId) ?? null;
  }
  async setName(playerId: string, name: string): Promise<void> {
    mem().names.set(playerId, name);
  }
  async getName(playerId: string): Promise<string | null> {
    return mem().names.get(playerId) ?? null;
  }
  async setSeen(playerId: string): Promise<void> {
    mem().seen.set(playerId, Date.now());
  }
  async getSeen(playerId: string): Promise<number | null> {
    return mem().seen.get(playerId) ?? null;
  }
  async saveGame(game: Game): Promise<void> {
    mem().games.set(game.id, game);
  }
  async getGame(id: string): Promise<Game | null> {
    return mem().games.get(id) ?? null;
  }
}

/* -------------------------------------------------------------------------- */

let backend: StoreBackend | null = null;

export function getStore(): StoreBackend {
  if (backend) return backend;
  const env = getRedisEnv();
  if (env) {
    backend = new RedisBackend(env.url, env.token);
  } else {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[xadrez] Redis não configurado em produção — usando memória (não confiável em serverless)."
      );
    }
    backend = new MemoryBackend();
  }
  return backend;
}

export type { StoredMatch, StoreBackend };
