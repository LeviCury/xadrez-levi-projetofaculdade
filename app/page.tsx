"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function getPlayerId(): string {
  const KEY = "xadrez:playerId";
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id =
      crypto.randomUUID?.() ??
      Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

type State = "idle" | "searching";

export default function Lobby() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");
  const [redisOff, setRedisOff] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setName(sessionStorage.getItem("xadrez:name") ?? "");
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRedisOff(d && d.redis === false))
      .catch(() => {});
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const goToGame = useCallback(
    (gameId: string) => {
      stopPolling();
      router.push(`/game/${gameId}`);
    },
    [router, stopPolling]
  );

  const play = useCallback(async () => {
    setError("");
    const playerId = getPlayerId();
    const finalName = name.trim() || "Anônimo";
    sessionStorage.setItem("xadrez:name", finalName);

    try {
      const res = await fetch("/api/matchmaking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, name: finalName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao entrar na fila");

      if (data.status === "matched") {
        goToGame(data.gameId);
        return;
      }

      // waiting -> polling
      setState("searching");
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(
            `/api/matchmaking?playerId=${encodeURIComponent(playerId)}`,
            { cache: "no-store" }
          );
          const d = await r.json();
          if (d.status === "matched") goToGame(d.gameId);
        } catch {
          /* mantém tentando */
        }
      }, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
    }
  }, [name, goToGame]);

  const cancel = useCallback(async () => {
    stopPolling();
    setState("idle");
    const playerId = getPlayerId();
    await fetch(`/api/matchmaking?playerId=${encodeURIComponent(playerId)}`, {
      method: "DELETE",
    }).catch(() => {});
  }, [stopPolling]);

  return (
    <div className="wrap">
      <h1>♟️ Xadrez da Equipe</h1>
      <p className="muted">
        Digite seu nome, clique em <b>Jogar</b> e entre na fila. Assim que outra
        pessoa entrar, vocês caem numa partida juntos.
      </p>

      {redisOff && (
        <div className="warn">
          ⚠️ O banco (Redis) não está configurado neste deploy. A fila e as
          partidas vão falhar de forma intermitente. Configure o Upstash Redis
          na Vercel (aba Storage) e faça um novo deploy.
        </div>
      )}

      <div className="panel" style={{ marginTop: 20 }}>
        {state === "idle" ? (
          <>
            <label htmlFor="name">Seu nome</label>
            <input
              id="name"
              type="text"
              value={name}
              maxLength={24}
              placeholder="ex.: Levi"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && play()}
            />
            <div style={{ marginTop: 16 }}>
              <button onClick={play}>Jogar</button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center" }}>
            <div className="status">Procurando oponente…</div>
            <p className="muted">
              Deixe esta aba aberta. Assim que alguém entrar na fila a partida
              começa.
            </p>
            <button className="secondary" onClick={cancel}>
              Cancelar
            </button>
          </div>
        )}
        <div className="err" style={{ marginTop: 12 }}>
          {error}
        </div>
      </div>
    </div>
  );
}
