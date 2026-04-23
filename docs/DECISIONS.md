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

## ADR-011 · Five building types, three tiers each
**Date:** 2026-04-24 · **Status:** Accepted (user call)

Buildings are **mining / farming / trading / science / warfare**, three
tiers each. Each type produces exactly one resource; higher tiers need
prereq research _and_ a prior-tier building at the same colony.

**Alternative considered:** my prior 4-type draft (mine / power / lab /
habitat). Rejected in favour of a cleaner 1-to-1 mapping between building
type and resource, plus the thematic handle of "farming" and "warfare" as
distinct branches.

**Revisit when:** playtest shows the variety bonus (§4.1) isn't landing
— if colonies feel like they should specialize rather than diversify, the
whole "variety fills jobs" mechanic gets rethought.

See [`GAMEPLAY.md §5`](./GAMEPLAY.md).

---

## ADR-012 · Credits are the only global resource; everything else is per-colony
**Date:** 2026-04-24 · **Status:** Accepted (user call)

Metal, Food, Science, Military — all **per-colony** accumulators. Only
Credits are a single empire-wide pool. Buildings and research started
_at_ a colony consume that colony's local stockpile. Ships launched from
a colony consume that colony's metal plus global credits.

**Alternative considered:** keeping a single global pool for simplicity
(the SP-1 first-pass I'd drafted). Rejected — the per-colony model is a
core part of the gameplay fantasy: colonies feel like real places that
have or don't have stuff.

**Implication:** the `player_resources` table becomes `colony_resources`
(or resources inline in `colonies`). The single-global row is only for
credits. Offline state shape changes too. The Drizzle migration and the
`OfflineApi` need to be rewritten before SP-1 is playable.

**Revisit when:** the data model can't carry transport semantics cleanly.
At that point move resources to a per-(colony, resource-type) row so
trade-route deltas don't rewrite entire colony accumulator rows.

See [`GAMEPLAY.md §3`](./GAMEPLAY.md).

---

## ADR-013 · Population cap is multi-factor (biome × tech × variety); food gates growth
**Date:** 2026-04-24 · **Status:** Accepted (user call)

```
cap = biomeBase × techMultiplier × varietyBonus
```

- `biomeBase` depends on planet type (molten 500 → earthlike 25k).
- `techMultiplier` grows with habitat techs (1.0 → 5.0 at late-game megacities).
- `varietyBonus` rewards having multiple building _types_ at a colony
  (0.5 at 1 type, 2.0 at all 5 types — "need variety to fill jobs").

Food is separate: each colony's pop consumes `pop / 10 000` food/s, and
growth scales by `clamp(produced/consumed, 0, 1.5)`. Starvation halts
growth; MVP leaves decay out.

**Alternative considered:** a single scalar cap per biome, with tech
bumps only. Rejected — "need variety to fill jobs" is a strong gameplay
hook the user explicitly called for, and it makes diverse colonies
strategically different from specialized ones.

**Revisit when:** the variety bonus feels gamey (players trivially max it
by building one of each and forgetting) — move variety onto the
_per-building-type count_ rather than just presence.

See [`GAMEPLAY.md §4`](./GAMEPLAY.md).

---

## ADR-014 · Empire score is GDP (aggregate credits/s)
**Date:** 2026-04-24 · **Status:** Accepted (user call)

The headline score is **current empire-wide credits/s**, summed across
every trade hub on every colony. Lifetime credits (total earned) exists
too, but GDP is the main "watch it tick up" number.

No victory condition — the game is open-ended idle. Milestones fire at
GDP thresholds (1, 10, 100, 1k, 10k credits/s).

**Alternative considered:** a weighted formula mixing population,
buildings, techs, colonies. Rejected as a "grab-bag" number that doesn't
really represent anything; GDP is legible and aligns with the fantasy
("build a financial empire").

**Revisit when:** GDP is trivially maxed by stacking trade hubs and
ignoring everything else. Rebalance via variety multiplier, or tie GDP
to a trailing average so spikes don't dominate.

See [`GAMEPLAY.md §9`](./GAMEPLAY.md).

---

## ADR-015 · Tech tree evolves five thematic branches into late-game megatech
**Date:** 2026-04-24 · **Status:** Accepted (user call)

One branch per building type. Each branch has ~3–4 techs that go from
"basic building tier-up" through mid-branch utility (reduced build time,
+caps, etc.) to **late-game exotic** (terraforming, orbital docks /
hauler ships, space stations, asteroid mining).

This guarantees every branch has a reason to be researched end-to-end
rather than players neglecting whole trees.

**Alternative considered:** unstructured tech web. Rejected — harder to
balance and harder for players to form a plan.

**Revisit when:** any branch is consistently skipped by players (the data
will tell us). Rebalance the skipped branch's late-game rewards.

See [`GAMEPLAY.md §6`](./GAMEPLAY.md).

---

## Template for new ADRs

```markdown
## ADR-NNN · Short title
**Date:** YYYY-MM-DD · **Status:** Accepted | Superseded by ADR-XXX

One paragraph of context + decision.

**Alternative considered:** what, why rejected.

**Revisit when:** the condition that would invalidate this choice.
```
