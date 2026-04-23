# Architecture

This is the design doc. [`README.md`](./README.md) covers _what we're building_
and _how to run it_; this file covers _how it works_ and _why_. Keep them in
sync when the design shifts.

## 1. Goals and constraints

1. **Persistent multiplayer galaxy.** Tens of thousands of stars, hundreds of
   concurrent players, thousands of slow-running colonies. Everyone shares one
   world per season.
2. **Idle-friendly.** Travel, research, terraforming, and population growth
   happen in wall-clock time. A player who closes the tab for a week comes
   back to an empire that advanced exactly as it would have if they'd watched.
3. **Mobile-first.** Touch-driven Three.js viewer, small payloads, works on a
   flaky connection.
4. **Cheap to run.** Vercel + Neon on free tiers for development and
   low traffic; scale within the same primitives. No additional paid
   infrastructure in v1.
5. **Fair.** Being online can't be a precondition for surviving. Rules are
   time-symmetric: whatever happens to an offline player would have happened
   if they'd been watching.

## 2. The lazy-sim model

The single most important decision: **we do not tick the world.** There is no
per-second server loop walking every colony. Instead:

- **Continuous quantities** (population, resources, research progress) are
  stored as `Accumulator { value, rate, t0, cap? }`. The current value at any
  time `t` is `min(cap, value + rate * (t - t0))`. Reads are free; writes only
  happen when the rate changes (building finishes, colony founded, etc.).
- **Discrete transitions** (fleet arrival, research unlock, terraform finish,
  combat) are rows in an `events` table keyed by `fire_at`. A Vercel Cron
  drains overdue events every minute; reading an empire lazily drains the
  caller's overdue events first so their state is always exact.
- **Combat** = a single `combat` event fired at the moment of encounter. No
  tick loop, no "every second check if fleets meet." When a fleet is launched
  the server computes the exact arrival time and any encounters along the
  way, and schedules events for each.

Cost scales with _events fired_, not _entities existing_. An empire of 10,000
idle colonies costs zero CPU until a player acts on one.

### Why not a server tick?

Tried-and-true MMO tick loops work because they amortize across many players.
For an idle game:

- 95%+ of entities are inert at any moment.
- Player sessions are bursty and short.
- We want to run on serverless. A persistent tick loop fights that.

The downsides of lazy sim are real but manageable: more care with
serializability (several writes can race for the same colony), and harder
debugging when a formula is wrong (you can't just watch it tick). We mitigate
with tight reducer tests and `SELECT FOR UPDATE` around event application.

## 3. Data model (Postgres, Chunk 4)

Shapes below are sketches, not final DDL. The authoritative definitions will
live in `packages/shared/src/state.ts` and a SQL migration.

| Table             | Key                  | Notes                                                                          |
| ----------------- | -------------------- | ------------------------------------------------------------------------------ |
| `galaxy`          | singleton (`id = 1`) | Seed + generator version. One row, ever. Immutable except for generator bumps. |
| `players`         | `player_id`          | Auth ID, display name, home-planet pick, created_at, last_active_at.           |
| `colonies`        | `colony_id`          | Owner, planet ref (`star_id:planet_idx`), population accumulator, buildings.   |
| `planet_overlays` | `planet_id`          | Sparse — only rows for planets that have been terraformed or pinned.           |
| `fleets`          | `fleet_id`           | Owner, composition (jsonb), from, to, depart/arrive timestamps.                |
| `research`        | `player_id, tech_id` | Completed techs. In-progress research lives in `events`.                       |
| `events`          | `event_id`           | `kind`, `payload_version`, `fire_at`, `owner_id`, `payload jsonb`. Indexed on `fire_at`. |
| `orders_log`      | `order_id`           | Append-only audit of player orders. Useful for rollback / debugging.           |

Planets and stars are **not stored.** They are a pure function of
`galaxy.seed + generator_version`. When a player terraforms a planet or any
other action pins its state, we insert a sparse row into `planet_overlays`.
Most planets will never have an overlay. If we ever bump
`generator_version`, we keep the old version in the shared lib so existing
overlays continue to resolve the planet they refer to.

Each event carries a `payload_version` so reducers can evolve payloads
without rewriting queued events (see §10 for the compatibility policy).

## 4. Request lifecycles

### 4.1 Player opens the game

1. Client fetches `/api/me` (REST). Server loads player row, colonies, fleets,
   and _pending_ events for that player.
2. Server calls `advanceTo(playerState, now())` — applies any events whose
   `fire_at <= now()` in order, emits follow-ups, rebases accumulators.
3. Persisted in one transaction: updated colony/fleet rows, consumed events,
   newly scheduled follow-ups, and a `last_seen_at` bump.
4. Response: the caught-up `PlayerView` (plus a visible-sector slice of the
   galaxy).

Idle-safety: because every read catches up, a player returning after a week
sees the same state they would have if they'd been online.

### 4.2 Player issues an order (launch fleet, start research)

1. Client POST `/api/orders` with the intent. Never with a timestamp — the
   server is the clock.
2. Server opens a transaction:
   - `SELECT ... FOR UPDATE` on the affected rows.
   - `advanceTo` the affected state (inline catch-up).
   - Validate the order against the _caught-up_ state (has the resources,
     prerequisite tech, etc.).
   - Deduct resources (`applyDelta` on the accumulator), schedule the
     completion event with a computed `fire_at`.
   - Append to `orders_log`.
3. Commit. Respond with the new state slice.

Every order is idempotent via a client-supplied `order_id` (UUID) checked
against `orders_log` to swallow retries.

### 4.3 Cron tick (`/api/tick`)

Vercel Cron hits `/api/tick` every minute. The handler:

1. `SELECT event_id FROM events WHERE fire_at <= now() ORDER BY fire_at LIMIT 500 FOR UPDATE SKIP LOCKED`.
2. For each event: load owner's affected state, call the pure `processEvent`
   reducer, persist updates + follow-ups, delete the event.
3. Bumps `players.last_sim_at` so the next client poll knows there's
   something new to fetch.

`SKIP LOCKED` means we can run multiple tick handlers concurrently (Vercel
Cron + on-demand triggers from reads) without double-processing. The
500-event cap prevents a backlog from blowing the function timeout; the
next minute mops up the rest. If backlog grows beyond a threshold we alert
and scale up tick frequency.

No pub/sub fanout in v1 — clients poll (see §5). When we need sub-15-second
pushes, we add a Redis-backed SSE channel here.

### 4.4 Fleet vs fleet (combat)

When a fleet is launched:

1. We scan known fleets whose path/time intersects. For each intersection,
   schedule a `combat` event at the encounter time.
2. The `combat` event loads both fleets, resolves deterministically (seeded
   RNG on `event_id` so retries produce the same outcome), and emits
   follow-up events: `fleet_arrive` for survivors, `colony_founded` if
   colony ships land, etc.

No realtime polling of fleet positions. Positions on the client are
interpolated from `(from, to, depart_at, arrive_at)`.

## 5. Realtime transport

v1: **polling only.** No SSE, no WebSockets, no pub/sub.

- Client polls `/api/me` on an interval (15s default, 60s when tab is
  hidden, paused when backgrounded on mobile). Low priority.
- `/api/me` is cheap: catches up the caller's overdue events, returns
  their state slice + a visible-sector slice of the galaxy. Most polls
  return an unchanged `last_sim_at` and the client short-circuits rendering.
- For important transitions (arrival, research complete), the client can
  drop the interval to 3s for a couple of minutes after the ETA so the
  update feels instant.
- No server-pushed state for other players' empires — fog of war means you
  only see intelligence at the moment you scan.

Why no SSE yet: requires a pub/sub layer (Redis) and long-lived
connections that Vercel Functions don't do well. The minute we need
sub-15-second latency we add a Redis-backed SSE channel (Upstash or Vercel
KV), reusing the same `/api/tick` that already knows when state changed.
Until then, polling is free and enough for an idle game.

## 6. Determinism and fairness

- **Clocks are server-only.** Client never tells the server what time it is.
- **All randomness is seeded.** Combat RNG seed = `hash(event_id)`. Galaxy
  RNG seed = `hash(season_seed, star_id)`. A reprocessed event produces the
  same outcome.
- **Offline players can't be dogpiled.** Candidate rule: a player offline for
  more than _N_ hours enters a shield that blocks incoming fleets aimed at
  undefended colonies. The shield drops either after login or after an
  in-game warning interval so active neighbours can't just permanently hide.
- **No client-side game logic for validation.** Client is a view + a
  prettier way to submit orders. Anything the server doesn't verify, it
  doesn't trust.

## 7. Scaling envelope and cost

Expected v1 load (persistent world, 500 active players, 20k stars):

| Resource         | Estimate                      | Tier                            |
| ---------------- | ----------------------------- | ------------------------------- |
| DB rows          | < 5 M colonies/fleets/events  | Neon free (0.5 GB) → Launch tier |
| Event rate       | ~5 events/sec peak            | Neon handles 100× comfortably    |
| Cron invocations | 1 / min (~43 k / month)       | Vercel Cron included            |
| API requests     | < 1 M / month @ 15s polling   | Vercel free tier                |

Because the universe is persistent, `events` and `orders_log` grow forever.
Plan: partition `events` monthly (Postgres declarative partitioning) and
archive old `orders_log` shards to cold storage after 90 days. Neither is
needed on day one — both become necessary somewhere around 10 M rows.

If any of those tip over, the fix is a paid tier on the same provider, not
a re-architecture. We avoid hard vendor coupling: Postgres is Postgres
(Neon → Supabase → RDS), the app is a plain Next.js app.

## 8. Failure modes

- **Tick backlog.** Symptom: `events` table grows; `lag = max(fire_at)` gets
  stale. Mitigation: page-sized drain, increase cron frequency, alert on
  lag > 2 min.
- **Transaction contention on a popular colony.** Mitigation: most writes
  touch only one owner's rows. Cross-player writes (combat) use a stable
  lock order (`ORDER BY colony_id`) to prevent deadlocks.
- **Non-deterministic reducer bug.** Symptom: replaying an event yields a
  different result. Mitigation: all randomness from seeded RNG; property
  tests in `shared` that replay an event and assert equality.
- **Time skew / daylight saving / leap seconds.** We only use UTC epoch ms
  server-side. Clients display local time but never submit time.

## 9. Persistent universe and new-player fairness

We picked a single persistent universe — no seasonal wipes. Civilizations
live forever; empires grow over years of real time. This is the core
fantasy of the game and seasons would undercut it.

Persistent MMOs have a well-known failure mode: early arrivals compound
their lead, new players can't catch up, churn kills the game. We mitigate
deliberately; none of these are optional, they are load-bearing.

**Catch-up ramps for new players.**
- First 14 days of play: 3× resource rate, 2× research speed, free starter
  fleet. Decays linearly to 1× at day 30.
- "Lost civilization" bonus: on account creation, roll a small random
  tech-tree head start so two new players on the same day aren't identical
  and the top of the tree isn't so far away that the early game feels
  pointless.

**Soft caps and diminishing returns on veteran power.**
- Research cost scales with the player's total completed research, not
  just the next tech — long-term players pay a galactic-knowledge tax.
- Per-colony population cap scales with building level but plateaus
  quickly; empire scaling comes from _more colonies_ (which takes time
  and is visible to neighbours) rather than infinite vertical stacking.
- Fleet upkeep costs scale superlinearly in fleet size — huge stacks are
  not free to maintain, which penalises parked doomstacks.

**Structural protections.**
- **Sanctuary sectors** near each player's home: only players within a
  small power band can attack inside. Leaves the sanctuary when you
  build outside it.
- **Offline shield**: see §6. In a persistent world this is critical —
  without it, vacation = death.
- **Attacker cooldown**: you can't repeatedly attack the same colony
  within a short window. Breaks farming patterns.
- **Inactivity decay**: players inactive for 30 days lose their shield;
  at 90 days, undefended colonies decay (buildings degrade, population
  drifts to zero) and eventually revert to neutral planets that anyone
  can colonise. Player's research and cosmetic progress survive — they
  can return and rebuild.

**Leaderboards over sliding windows.**
- Rankings are 30-day and 90-day, not all-time. An all-time board exists
  for bragging rights but doesn't gate content.

**Content expansion as a substitute for wipes.**
- When the meta stalls, we add new tech tiers, new ship hulls, new biomes,
  new mid-late-game goals. Veterans get a new horizon; new players can
  skip to the latest tier via the catch-up ramp.
- We explicitly reserve the option of a one-time "great reset" event
  later in the game's life, but it would be signaled months ahead and
  cosmetic rewards would preserve veteran identity.

**Schema and event-payload compatibility.**
Because the world never wipes, every event payload shape we ship must
remain processable indefinitely. Rules:
- Every event row carries a `payload_version int`.
- Reducers switch on `(kind, payload_version)` and only add new
  handlers — never remove old ones.
- Breaking a payload is done by adding a new kind, not mutating an old one.
- Schema migrations are additive; columns get dropped only after a
  follow-up migration ensures no event references them.

## 10. Technology decisions (with trade-offs)

- **Next.js on Vercel.** Colocated client + API + cron. Trade-off: serverless
  cold starts and no persistent processes — fine for our access pattern.
- **Neon Postgres.** Branching for PR previews, serverless Postgres, Vercel
  integration. Trade-off: cold starts on the free tier; pre-warm via the
  tick cron.
- **No Redis / Upstash in v1.** Rate limits, caching, and read-after-write
  all live in Postgres for now. Trade-off: polling-only realtime (~15 s
  latency). We add Redis only when we need sub-15-second pushes, and it
  will be a pure addition — no schema changes required.
- **Clerk** for auth. Trade-off: vendor lock; mitigated by storing only the
  subject claim in our DB, so we could swap to Supabase Auth.
- **No SpaceTimeDB, no dedicated game server.** Trade-off: we lose the
  "logic lives next to data" model. We gain: stateless functions, no VMs,
  no game-loop ownership, cheap.
- **Polling, not WebSockets (v1).** Trade-off: ~15-second latency floor
  for cross-player events. Acceptable for an idle game. SSE + pub/sub is
  a later upgrade, not a rewrite.
- **Persistent universe, not seasons.** Trade-off: more live-ops work
  (balance patches, content expansions) to keep the game fair and
  interesting over the long haul. Pays off in the "your civilization is
  real and lasting" fantasy that is core to the game's identity.

## 11. What this doc will eventually need

- Exact Postgres DDL once Chunk 4 lands, including the partitioning
  scheme for `events` and `orders_log`.
- Formal event payload schemas with `payload_version` tags (today they're
  stubbed in `packages/shared`).
- The balance sheet: resource rates, research costs, ship build times,
  and how the new-player catch-up curves land on those numbers.
- Admin / moderation flow.
- Backup + disaster-recovery runbook (there is no "just start the new
  season" escape hatch in a persistent world, so backups matter more).
- Inactivity-decay spec: exact thresholds, how buildings degrade, who
  inherits a decayed colony.
