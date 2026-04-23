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
4. **Cheap to run.** Vercel + Neon + Upstash on free tiers for development and
   low traffic; scale within the same primitives.
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

| Table             | Key                 | Notes                                                                          |
| ----------------- | ------------------- | ------------------------------------------------------------------------------ |
| `galaxies`        | `season_id`         | Seed, generator version, start/end timestamps. One row per season.             |
| `players`         | `player_id`         | Auth ID, display name, home-planet pick, season.                               |
| `colonies`        | `colony_id`         | Owner, planet ref (`star_id:planet_idx`), population accumulator, buildings.   |
| `fleets`          | `fleet_id`          | Owner, composition (jsonb), from, to, depart/arrive timestamps.                |
| `research`        | `player_id, tech_id`| Completed techs. In-progress research lives in `events`.                       |
| `events`          | `event_id`          | `kind`, `fire_at`, `owner_id`, `payload jsonb`. Indexed on `fire_at`.          |
| `orders_log`      | `order_id`          | Append-only audit of player orders. Useful for rollback / debugging.           |

Planets and stars are **not stored.** They are a pure function of
`galaxies.seed + generator_version`. If we ever need to pin a planet's state
(e.g. because a player terraformed it), we store a sparse **overlay** row
keyed by `(planet_id, season_id)`. Most planets will never have an overlay.

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
3. Publishes a Redis pub/sub message on `player:<id>:delta` for any
   connected clients listening over SSE.

`SKIP LOCKED` means we can run multiple tick handlers concurrently (Vercel
Cron + on-demand triggers) without double-processing. The 500-event cap
prevents a backlog from blowing the function timeout; the next minute mops
up the rest. If backlog grows beyond a threshold we alert and scale up tick
frequency.

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

v1: **polling + SSE**, not WebSockets.

- Client polls `/api/me` on an interval (15s default, 60s when tab is
  hidden). Low priority.
- When viewing your own empire, client opens an SSE stream to
  `/api/stream` that forwards Redis pub/sub `player:<id>:delta` messages.
  SSE survives Vercel's request timeouts by reconnecting; the client dedupes
  on a monotonic `delta_seq`.
- No server-pushed state for other players' empires — the fog-of-war model
  means you only see intelligence at the moment you scan.

We can swap to WebSockets if we ever need two-way realtime for something
like real-time diplomacy chat. Until then, SSE is enough and much cheaper.

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

Expected v1 load (single season, 500 active players, 20k stars):

| Resource         | Estimate            | Tier                            |
| ---------------- | ------------------- | ------------------------------- |
| DB rows          | < 5 M total         | Neon free (0.5 GB) → Launch tier |
| Event rate       | ~5 events/sec peak  | Neon happily handles 100×        |
| Cron invocations | 1 / min             | Vercel Cron included            |
| API requests     | < 1 M / month       | Vercel free tier                |
| Redis ops        | < 500 K / month     | Upstash free tier               |

If any of those tip over, the fix is a paid tier on the same provider, not
a re-architecture. We avoid hard vendor coupling: Postgres is Postgres
(Neon → Supabase → RDS), Redis is Redis (Upstash → ElastiCache), the app is
a plain Next.js app.

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

## 9. Seasons vs persistent universe

Persistent universes get dominated by early players. We plan seasons from
day one: each season is a new `galaxy_id`, a wipe of colonies / fleets /
events, and a preserved `player_profile` row that carries cosmetic / meta
progress across seasons.

Implications:
- All foreign keys are scoped by season.
- The galaxy generator is stable across seasons only in structure; the seed
  changes so planets reshuffle.
- Migrations add new event kinds, never remove or repurpose old ones —
  old event rows must remain processable at least until the season ends.

## 10. Technology decisions (with trade-offs)

- **Next.js on Vercel.** Colocated client + API + cron. Trade-off: serverless
  cold starts and no persistent processes — fine for our access pattern.
- **Neon Postgres.** Branching for PR previews, serverless Postgres, Vercel
  integration. Trade-off: cold starts on the free tier; pre-warm via the
  tick cron.
- **Upstash Redis.** HTTP-friendly Redis that works from Vercel Functions.
  Trade-off: not the fastest per-op; fine for pub/sub + small caches.
- **Clerk** for auth. Trade-off: vendor lock; mitigated by storing only the
  subject claim in our DB, so we could swap to Supabase Auth.
- **No SpaceTimeDB, no dedicated game server.** Trade-off: we lose the
  "logic lives next to data" model. We gain: stateless functions, no VMs,
  no game-loop ownership, cheap.
- **Polling + SSE, not WebSockets (v1).** Trade-off: higher latency for
  cross-player events (~15 s worst case). Acceptable for an idle game.

## 11. What this doc will eventually need

- Exact Postgres DDL once Chunk 4 lands.
- Formal event payload schemas (today they're stubbed in `packages/shared`).
- The balance sheet: resource rates, research costs, ship build times.
- Admin / moderation flow.
- Backup + season-rollover runbook.
