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

## Docs map

- [`docs/GAMEPLAY.md`](./docs/GAMEPLAY.md) — _what the player experiences._
  Mechanics, buildings, tech tree, ships, balance targets.
- [`docs/VISUALS.md`](./docs/VISUALS.md) — _how the game looks._ Researched
  star / planet / nebula / spiral-galaxy techniques, with links and code
  sketches. The reference doc for the V-track (V-1..5).
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — _what we're building next._
  Shortest path to playable single-player and the parallel visual overhaul.
- [`docs/DECISIONS.md`](./docs/DECISIONS.md) — _ADR log._ Every design call
  with its alternative and "revisit when" trigger.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — _how the server works._ Data
  model, request lifecycles, failure modes, scaling envelope.

## Services / stack (cheap + Vercel-only in v1)

| Concern       | Pick                          | Notes                                        |
| ------------- | ----------------------------- | -------------------------------------------- |
| Client + API  | Next.js on **Vercel**         | App Router, API routes, cron — one deploy   |
| Renderer      | Three.js + @react-three/fiber | Added in Chunk 2                             |
| DB            | **Neon Postgres**             | Free tier, native Vercel integration         |
| Worker        | **Vercel Cron**               | Hits `/api/tick` every minute, drains events |
| Auth          | **Clerk** (or Supabase)       | Free tier, mobile-friendly social login      |
| Realtime      | Polling (15s / 60s)           | Idle game; SSE + Redis added later if needed |

_Deliberately skipped (v1):_
- SpaceTimeDB — fights our lazy-sim model, adds hosting lock-in.
- Upstash / Redis — not needed for polling. Add it only when sub-15-second
  push matters. See [`ARCHITECTURE.md` §5, §10](./ARCHITECTURE.md).
- Dedicated WebSocket servers.

_Universe model:_ **persistent** (no seasonal wipes). See
[`ARCHITECTURE.md` §9](./ARCHITECTURE.md) for the new-player fairness
mechanics that make this work.

## Status

Working: offline single-player loop (pick home, research, launch colony
ships, wait for them to land, see colonies appear). Online stack is built
but dormant behind a stubbed-out auth layer. See
[`docs/ROADMAP.md`](./docs/ROADMAP.md) for the shortest path to a playable
single-player MVP; the full chunk-by-chunk history is there too.

**Next up:** Chunk 6c (buildings with real rate effects) and
Chunk 8 (tech tree with real effects). See the roadmap.

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

### Offline mode (no Neon, no Clerk)

Run the whole game entirely in the browser, backed by `localStorage`.
Useful while the stack is still stubbed out.

```bash
NEXT_PUBLIC_OFFLINE_MODE=true pnpm dev
```

All the same validation and event-queue logic runs in-browser; the only
things you lose are persistence across devices and real multiplayer.
Look for the green `offline` badge in the HUD. A `Reset offline save`
button is available there if you want to start over.

### GitHub Pages demo

Every push to `main` deploys a static, offline-mode build to
`https://<owner>.github.io/<repo>/`. Any branch can be deployed manually
via **Actions → Deploy offline demo to GitHub Pages → Run workflow**
(you pick the branch in the dropdown).

The workflow deletes `apps/web/app/api/` before building so Next's
static export mode doesn't fail on the dynamic route handlers.

### Database (Neon + Drizzle)

The schema lives in `apps/web/lib/db/schema.ts`; SQL migrations are
generated into `apps/web/lib/db/migrations/`.

Set up a Neon project, copy the **pooled** connection string into
`apps/web/.env.local`:

```bash
cp apps/web/.env.example apps/web/.env.local
# edit DATABASE_URL
```

Then run migrations:

```bash
pnpm --filter web db:migrate     # apply migrations to the DB
# or while iterating on schema:
pnpm --filter web db:generate    # regenerate SQL from schema.ts
pnpm --filter web db:studio      # open the Drizzle inspector
```

The app lazily constructs its DB client — `pnpm build` / `pnpm dev` still
work without `DATABASE_URL` set, and any route that actually touches the
DB will fail loudly with a clear error.

## Open questions (before Chunk 4)

- Persistent universe vs. seasons (3–6 months)? Recommendation: seasonal from
  day one — easier to retrofit fairness.
- Offline-shield window: how long before an idle player can be attacked?
- Galaxy size for v1: 10k, 20k, more?
