# ♟️ Xadrez da Equipe

Xadrez online simples com **fila de pareamento**: cada pessoa abre o site, digita o nome, clica em **Jogar** e entra na fila. Quando outra pessoa entra, as duas caem numa partida juntas. Regras completas de xadrez (validação de lances, xeque, xeque-mate, empate, promoção) via [`chess.js`](https://github.com/jhlywa/chess.js).

Feito em **Next.js** (App Router) e pronto pra publicar na **Vercel**.

## Como funciona

- **Lobby** (`/`): nome + botão *Jogar* → entra na fila e fica esperando (polling).
- **Pareamento**: quem entrou primeiro joga de **brancas**; o segundo, de **pretas**.
- **Partida** (`/game/[id]`): tabuleiro responsivo com clique ou arrastar-e-soltar, animações de movimento, seletor de promoção e destaque de xeque e da última jogada.
- **Acompanhamento**: cada jogador vê as peças que capturou, seus pontos de material, a vantagem atual e o histórico organizado lance a lance.
- Dá pra **Desistir**, **Voltar ao lobby** ou acompanhar uma partida como espectador.
- O estado sincroniza por *polling* (~1s), então não precisa de servidor WebSocket — funciona bem no serverless da Vercel.
- Entradas "fantasma" na fila (quem entrou e fechou a aba) são descartadas automaticamente por um *heartbeat*.

## Rodar localmente

```bash
npm install
npm run dev
```

Abra <http://localhost:3000>. Para testar o pareamento, abra **duas abas** (ou dois navegadores) — cada aba é um jogador diferente. Clique em *Jogar* nas duas.

> Localmente não precisa de banco: o estado fica em memória (funciona porque `next dev` roda num único processo).

## Publicar na Vercel

Em produção serverless as funções não compartilham memória, então é preciso um **Redis**. A forma mais simples é o **Upstash** pelo Marketplace da Vercel (tem plano free):

1. Suba este projeto num repositório (GitHub/GitLab/Bitbucket).
2. Na Vercel: **New Project** → importe o repositório.
3. No projeto, aba **Storage** → **Create Database** → **Upstash for Redis** (ou Marketplace → Upstash) → conecte ao projeto. Isso adiciona automaticamente as variáveis de ambiente (`KV_REST_API_URL` e `KV_REST_API_TOKEN`).
4. **Deploy**. Pronto — mande o link pra galera.

O código detecta o Redis pelas variáveis `KV_REST_API_URL`/`KV_REST_API_TOKEN` **ou** `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`. Veja `.env.example`.

## Estrutura

```
app/
  page.tsx                 # lobby (fila)
  game/[id]/page.tsx       # tabuleiro / partida
  api/matchmaking/route.ts # entrar/consultar/sair da fila
  api/game/route.ts        # estado da partida
  api/game/move/route.ts   # aplicar lance (validado no servidor)
  api/game/resign/route.ts # desistir
lib/
  store.ts                 # Redis (prod) + memória (dev)
  matchmaking.ts           # fila e criação de partida
  game.ts                  # aplicar lance / desistência
  types.ts
```

## Notas

- A validação de lances acontece **no servidor** (`chess.js`), então não dá pra trapacear pelo cliente.
- Partidas e fila expiram em ~1 dia no Redis.
- É intencionalmente simples: sem contas, sem relógio, sem ranking. Só entrar e jogar.
