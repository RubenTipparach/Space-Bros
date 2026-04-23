# Decision log

Every design or tech call with a real trade-off. Additive only — don't
edit an ADR once it's landed; write a new one that supersedes it.

Format: **ADR-NNN** · title · date · status. Always include the
_alternative considered_ and _what would make us revisit._

---

## ADR-001 · Lazy-sim, event-queue simulation
**Date:** 2026-04-23 · **Status:** Accepted

Continuous quantities (population, resources, research) are stored as
`(value, rate, t0)` accumulators and evaluated on read. Discrete transitions
(fleet arrival, research complete) are rows in an `events` table keyed by
`fire_at`. A Vercel Cron drains overdue events; reads lazily drain the
caller's queue first.

**Alternative considered:** server-side tick loop processing every entity
every second. Rejected because it doesn't scale — 95%+ of entities are idle,
and a persistent tick fights serverless runtimes.

**Revisit when:** events-per-second is consistently ≥ the drain capacity of
a 60-second cron window (would need sub-cron pushers or a long-lived worker).

---

## ADR-002 · Persistent universe, no seasons
**Date:** 2026-04-23 · **Status:** Accepted (user call)

One galaxy, no wipes. Catch-up mechanics (new-player ramp, offline shield,
inactivity decay, sliding-window leaderboards) replace seasons as the
fairness lever.

**Alternative considered:** seasonal wipes every 3–6 months. Rejected
because "your civilization lives forever" is the core fantasy.

**Revisit when:** new-player retention data shows the meta is dead — a
one-time "great reset" is the escape hatch, pre-announced months ahead.

See [`ARCHITECTURE.md §9`](../ARCHITECTURE.md) for the fairness mechanics.

---

## ADR-003 · Vercel + Neon + Clerk for the online stack
**Date:** 2026-04-23 · **Status:** Accepted

- Client + API + cron on Vercel (Next.js App Router).
- Postgres on Neon (pooled connection).
- Auth via Clerk (free tier) — currently stubbed behind `lib/auth.ts`.

**Alternative considered:** Supabase (bundles auth + DB + realtime).
Stayed on the Next+Neon+Clerk split because (a) Vercel's DX is sharper
for the compute side, (b) Supabase's realtime is Postgres-CDC-based, not
ideal for game state fanout.

**Revisit when:** we hit a wall on Neon cold starts (move to Supabase
Pooler, or Vercel Postgres) or Clerk pricing (move to Supabase Auth —
auth is the most portable choice we've made).

---

## ADR-004 · No Redis / Upstash in v1
**Date:** 2026-04-23 · **Status:** Accepted (user call)

Polling-only realtime (15s active / 60s hidden). Rate limits + read-after-
write consistency handled in Postgres. SSE + pub/sub is a pure upgrade
path, not a required piece of day-one infra.

**Revisit when:** poll-latency ≥ 15 s starts to hurt UX (unlikely for an
idle game) or when Postgres-based rate limits strain under abuse.

---

## ADR-005 · Travel at 5 min per light-year (base)
**Date:** 2026-04-23 · **Status:** Accepted (user call)

Galaxy coordinates _are_ light-years (disk radius ~500 ly). Base travel is
5 min/ly. Research multiplies (stackable ×0.75 per tier of Faster Ships).

Nearest hops: minutes. Sector trips: hours. Cross-galaxy: days.

**Alternative considered:** seconds-per-ly (too fast, ruins the idle
pacing) or hours-per-ly (too slow, new players never see their colony
land). 5 min/ly hits the "do a thing, come back in 10 minutes" early-game
hook.

**Revisit when:** playtest shows new players bouncing before their first
colony lands. Reduce to 3 min/ly, not faster.

---

## ADR-006 · SpaceTimeDB rejected
**Date:** 2026-04-23 · **Status:** Accepted

Cool tech but pushes game logic into a tick-model database with its own
hosting. Fights our lazy-sim approach and introduces vendor lock-in.

**Revisit when:** never, realistically. If the sim grows beyond what
Postgres + Vercel can carry, the cheaper next step is sharding Postgres,
not swapping data-model paradigms.

---

## ADR-007 · Deterministic galaxy from seed, not persisted
**Date:** 2026-04-23 · **Status:** Accepted

Stars and planets are a pure function of `galaxy.seed + generatorVersion`.
No 20k-row `stars` table. Terraform / pin state lives in a sparse
`planet_overlays` table.

**Alternative considered:** materialize the galaxy once. Rejected — 12k
stars × planets × metadata would dwarf real game state; regeneration is
20–50 ms and runs on every cold start, cached thereafter.

**Revisit when:** we add mutable per-star state beyond planet overlays
(e.g., wormhole networks, megastructures). Then pinning becomes the default.

---

## ADR-008 · API adapter pattern + offline mode via localStorage
**Date:** 2026-04-23 · **Status:** Accepted (user call)

`lib/api/` exposes a `ServerApi` interface. Two impls:
- `HttpApi` — fetch-based, hits the Next.js routes.
- `OfflineApi` — localStorage-backed, all validation + event draining
  runs in the browser.

Switched via `NEXT_PUBLIC_OFFLINE_MODE=true` at build time.

**Why:** the user wants to (a) play single-player without external
services, (b) ship a static demo on GitHub Pages. Both fall out
naturally from the adapter.

**Trade-off:** three implementations of the core sim semantics —
the pure reducer in `@space-bros/shared`, the DB mirror in
`lib/db/tick.ts`, and the offline impl. Drift risk.

**Revisit when:** the first drift bug hits. Mitigation: cross-impl
property tests (same events through all three, same final state).

---

## ADR-009 · Single-player first, multiplayer later
**Date:** 2026-04-24 · **Status:** Accepted (user call)

Deprioritize Clerk, real multiplayer, combat, fog-of-war, and the
persistent-universe fairness system. Prioritize: buildings with real
rate effects, an actual tech tree, travel preview, empire score.

Offline mode is the single-player game. Online stack sits cold until
a real user pushes us to wire it.

**Revisit when:** single-player MVP is shipped and playable, see
[`ROADMAP.md`](./ROADMAP.md).

---

## ADR-010 · pnpm workspace, `packageManager` pins pnpm
**Date:** 2026-04-23 · **Status:** Accepted (CI bug fix)

pnpm version lives in `package.json#packageManager`. GitHub Actions
reads it via `pnpm/action-setup@v4` without a `version:` override, so
we don't have two sources of truth.

**Revisit when:** the workflow or local shells start complaining about
pnpm version mismatches again.

---

## Template for new ADRs

```markdown
## ADR-NNN · Short title
**Date:** YYYY-MM-DD · **Status:** Accepted | Superseded by ADR-XXX

One paragraph of context + decision.

**Alternative considered:** what, why rejected.

**Revisit when:** the condition that would invalidate this choice.
```
