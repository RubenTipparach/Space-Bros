# Space-Bros

An incremental, persistent, multiplayer galaxy-conquest game. Browser-based
(Three.js), mobile-friendly, and cheap to host.

## The pitch

- Procedural galaxy of 10k–20k stars, each with a solar system.
- Every player picks a home planet, climbs a research tree (faster ships,
  bigger colony ships, terraforming, outposts).
- Travel, research, terraforming all take wall-clock time. Idle-game loop.
- Fully persistent and authoritative: the server simulates whether you're
  online or not.

## Design pillars

1. **Idle-first.** The game state advances in wall-clock time. Clients never
   advance the simulation; they only view it and submit orders.
2. **Deterministic galaxy.** The map is a pure function of a seed. We only
   persist the seed + generator version, not 20k stars.
3. **Lazy simulation.** Continuous quantities (population, resources, research
   progress) are stored as `(value, rate, t0)` and evaluated on read. Discrete
   transitions (ship arrives, research completes) live in an event queue keyed
   by `fire_at`.
4. **No background tick while idle.** A cron drains overdue events. Reading a
   player's empire also catches them up on demand.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the deeper design
(data model, request lifecycles, failure modes, scaling envelope).

## Services / stack (cheap + Vercel-friendly)

| Concern       | Pick                        | Notes                                         |
| ------------- | --------------------------- | --------------------------------------------- |
| Client + API  | Next.js on **Vercel**       | App Router, API routes, cron — one deploy    |
| Renderer      | Three.js + @react-three/fiber | Added in Chunk 2                            |
| DB            | **Neon Postgres**           | Free tier, native Vercel integration          |
| Cache / queue | **Upstash Redis**           | Serverless, free tier                         |
| Worker        | **Vercel Cron**             | Hits `/api/tick` every minute, drains events  |
| Auth          | **Clerk** (or Supabase)     | Free tier, mobile-friendly social login       |
| Realtime      | Polling + SSE (v1)          | Idle game; WebSockets only if we need them    |

_Deliberately skipped:_ SpaceTimeDB (pushes logic into a tick-model DB with
its own hosting; fights our lazy-sim approach), dedicated WS servers.

## Build plan (chunks)

- [x] **Chunk 0** — Repo skeleton: pnpm workspace, Next.js app, shared lib.
- [ ] **Chunk 1** — Deterministic galaxy generator (types + tests in `shared`,
  already stubbed; expand planets/resources/spiral arms).
- [ ] **Chunk 2** — Three.js galaxy viewer: instanced stars, tap-to-select,
  mobile-first controls.
- [ ] **Chunk 3** — Sim core: accumulators, event queue, pure `processEvent`.
- [ ] **Chunk 4** — Persistence + auth: Postgres schema, Clerk, home-planet
  pick flow.
- [ ] **Chunk 5** — Tick worker: `/api/tick` Vercel Cron + `SKIP LOCKED` drain.
- [ ] **Chunk 6** — Order API: build, launch, research, terraform.
- [ ] **Chunk 7** — Realtime (SSE) + optimistic UI reconciliation.
- [ ] **Chunk 8** — Research & terraforming trees (data-driven).
- [ ] **Chunk 9** — Multi-player interactions: outposts on shared planets,
  fog of war.
- [ ] **Chunk 10** — Combat + diplomacy MVP.
- [ ] **Chunk 11** — PWA polish + web push for completed events.
- [ ] **Chunk 12** — Anti-cheat, admin, backup, seasons.

## Repo layout

```
.
├── apps/
│   └── web/           Next.js 15 (App Router) — client + API routes + cron
└── packages/
    └── shared/        Pure TS: RNG, galaxy gen, sim math, types
```

`@space-bros/shared` is imported from the web app via `transpilePackages` so
the same code runs on the client (viewer), in route handlers (orders), and in
the cron (`/api/tick`).

## Getting started

Requirements: Node 22+, pnpm 10+.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev           # http://localhost:3000
```

## Open questions (before Chunk 4)

- Persistent universe vs. seasons (3–6 months)? Recommendation: seasonal from
  day one — easier to retrofit fairness.
- Offline-shield window: how long before an idle player can be attacked?
- Galaxy size for v1: 10k, 20k, more?
