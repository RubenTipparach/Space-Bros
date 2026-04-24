# Multiplayer

Everything about sharing the galaxy with other players, parked until
after single-player MVP per [ADR-009](./DECISIONS.md). This doc is the
_reference_ for when we turn multiplayer on — read it before touching
Clerk, SSE, combat, or any cross-player feature.

> Current focus: SP-1..5 (see [`ROADMAP.md`](./ROADMAP.md)).
> Multiplayer is _designed_ but not _built_ — the schema and ADRs
> already accommodate it.

## 1. Scope — what "multiplayer" means

One persistent galaxy, many players (ADR-002). What they share:

- **The map.** Same galaxy seed for everyone; everyone sees the same
  stars, biomes, clusters.
- **Visibility of other empires**, under fog-of-war rules (§4).
- **Conflict.** Fleets can intercept each other (§5); colonies can be
  raided.
- **Diplomacy and trade.** Alliances, non-aggression pacts, chat,
  credit-for-resource trades (§7).
- **Leaderboards.** Sliding-window 30/90-day GDP rankings; all-time is
  bragging rights.

What they don't share: research (personal), stockpiles (per-player),
cosmetic progression.

## 2. Authentication (Chunk 4c)

Current state: `apps/web/lib/auth.ts` has a dev-cookie fallback for
local development and a Clerk branch stubbed with a TODO. Real
multiplayer needs real auth so that orders and GDP are attributable.

**Work to light up Clerk:**

- Install `@clerk/nextjs`, add `CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`
  to env.
- Wrap `apps/web/app/layout.tsx` in `<ClerkProvider>`.
- Add `middleware.ts` using `clerkMiddleware()` to gate route handlers.
- In `lib/auth.ts`, swap the Clerk TODO: call `auth()` from
  `@clerk/nextjs/server` and return the `userId` claim, throwing
  `UnauthorizedError` on null.
- Disable the dev-cookie path in production (`DevCookieDisabledError`
  already does this).
- Add sign-in / sign-up pages (Clerk's prebuilt components are fine).

**Migration:** existing dev-cookie players in prod become signed-in
players by linking their `dev_<uuid>` to a Clerk `sub`. For the
pre-launch phase that's a one-off script.

## 3. Realtime transport (Chunk 7)

Polling-only today (ADR-004). For multiplayer the problem is:
player A's action is relevant to player B in seconds, not 15.

**Upgrade path, in order:**

1. **Add Upstash Redis** (re-opens ADR-004; note it when you do).
2. `/api/tick` publishes a small delta envelope on
   `empire:<playerId>` whenever it mutates a player's state.
3. New `/api/stream` SSE endpoint opens an EventSource, subscribes to
   the Redis channel, forwards messages. Reconnect resilient.
4. Client dedupes on a monotonic `delta_seq` from the server (so a
   reconnect can't replay events).
5. Poll stays around as a 60-second fallback in case SSE is blocked by
   a firewall.

**We do NOT need WebSockets** unless/until we add two-way realtime chat
(diplomacy) — SSE + POST covers everything else.

## 4. Shared-galaxy semantics (Chunk 9)

### 4.1 Fog of war

`/api/me` today returns the caller's full state. With multiplayer it
needs to return:
- **my empire**: full resolution (unchanged)
- **visible sector slice**: lossy view of other empires' presence
  (colonies coloured by owner, named if scanned)
- **active scans**: fleets in transit across the visible area

### 4.2 Visibility tiers

| Tier       | What the player sees                                      |
| ---------- | --------------------------------------------------------- |
| **Unknown** | just the star; no colony info                             |
| **Known**   | colony exists, owner id only                              |
| **Detected** | +approx population, +presence of fleets in the system     |
| **Scanned** | full detail (buildings, science progress), costs science |

Sensors research (`sensors_1` / `sensors_2` in the planned tech tree
— see [`GAMEPLAY.md §6`](./GAMEPLAY.md)) raises the radius in which
stars are auto-Detected. Explicit scans (new order type) upgrade a
single star to Scanned for N hours.

### 4.3 Outposts on shared planets

Per the pitch, outposts can share a planet. Rules:
- A player may build an outpost on any planet _not_ occupied by a
  full colony of another player.
- Population growth is zero on outposts (already the design —
  hab-gated).
- Multiple outposts coexist on one planet at different "slots."

## 5. Combat (Chunk 10)

### 5.1 Encounter scheduling

When a fleet is launched, the server scans known fleets for path +
time intersections. For each intersection:

1. Compute encounter time (exact).
2. Insert a `combat` event with `fire_at = encounterTime`, payload
   `{ fleetAId, fleetBId }`.
3. Re-derive any downstream fleet events (a defender's fleet heading
   somewhere else might get its route cut short).

Fleets launched _into_ a combat ongoing at the arrival star land on
the loser side (defender) or attacker side, depending on owner.

### 5.2 Resolver

Pure function keyed by `hash(event_id)`:

```
resolve(fleetA, fleetB, rngSeed) -> { surviving: fleet[], casualties: {...} }
```

Consumes the attacker's and defender's **Military stockpile** (finally
giving Barracks a job) as ammunition. Seeded RNG so retries produce
the same outcome.

### 5.3 Ship variety needed

Adding to GAMEPLAY §7:

- **Scout** — cheap, fast, reveals a star (Scanned) when it arrives.
  Paired with sensor tech.
- **Frigate** — cheap combat unit.
- **Destroyer** — mid-tier; counter to frigates.
- **Capital** — expensive; tanks damage.

Combat math: rock/paper/scissors across the four, tuned so no single
ship type dominates.

### 5.4 Defender protections (multiplayer only — critical)

Without these, the persistent-universe dogpile problem (see §6)
destroys the game:

- **Offline shield** — see §6.1.
- **Attacker cooldown** — same attacker can't hit the same colony
  within a short window.
- **Attrition on deep expeditions** — fleets over X ly from the
  attacker's nearest colony take morale-style attrition.
- **Sanctuary sectors** — see §6.2.

## 6. Persistent-universe fairness

Moved verbatim from the old `ARCHITECTURE.md §9`. We chose a single
persistent universe — no seasonal wipes — so the lifetime fairness
levers have to exist from the start or the meta collapses.

**None of these are optional; they are load-bearing.**

### 6.1 Offline shield

A player offline for more than `N` hours enters a shield that blocks
incoming fleets aimed at undefended colonies. Shield drops shortly
after login (so active neighbours can attack you again) or after an
in-game warning interval. Candidate N: 6–12 hours.

### 6.2 Sanctuary sectors

Near each player's home is a protected region where only players within
a small power band can attack inside. When you build outside the
sanctuary, the protection lifts for your new colonies (but your home
stays safe).

### 6.3 Catch-up ramps for new players

- First 14 days of play: 3× resource rate, 2× research speed, free
  starter fleet. Decays linearly to 1× at day 30.
- "Lost civilization" bonus: on account creation, roll a small random
  tech-tree head start so two new players on the same day aren't
  identical and the late tech isn't unreachably far.

### 6.4 Soft caps on veteran power

- Research cost scales with total completed research (galactic-knowledge
  tax).
- Per-colony population cap plateaus quickly — empire scaling comes from
  _more colonies_ (visible to neighbours, takes time) rather than
  vertical stacking.
- Fleet upkeep costs scale superlinearly with fleet size — parked
  doomstacks aren't free.

### 6.5 Attacker cooldown

You can't repeatedly attack the same colony within a short window.
Breaks farming patterns.

### 6.6 Inactivity decay

Players inactive for 30 days lose their shield; at 90 days, undefended
colonies decay (buildings degrade, population drifts to zero) and
eventually revert to neutral planets that anyone can colonise.
Research and cosmetic progress survive — they can return and rebuild.

### 6.7 Leaderboards over sliding windows

Rankings are 30-day and 90-day, not all-time. An all-time board exists
for bragging rights but doesn't gate content.

### 6.8 Content expansion as a substitute for wipes

When the meta stalls, we add new tech tiers, new ship hulls, new biomes,
new mid-late-game goals. Veterans get a new horizon; new players can
skip to the latest tier via the catch-up ramp. A one-time "great reset"
event is available as the nuclear option, signalled months ahead.

### 6.9 Schema/event compatibility

Because the world never wipes, every event payload shape we ship must
remain processable indefinitely. Rules:

- Every event row carries `payload_version int`.
- Reducers switch on `(kind, payload_version)` and only _add_ new
  handlers — never remove old ones.
- Breaking a payload = new kind, not mutating old one.
- Migrations additive; columns get dropped only after a follow-up
  migration ensures no event references them.

## 7. Diplomacy, chat, alliances, trade

Non-MVP, listed for context so the schema doesn't paint us into a
corner.

- **Alliances**: joinable groups, shared-vision with members, alliance
  chat, optional shared leaderboard.
- **Non-aggression pacts (NAPs)**: two-player agreements with automatic
  enforcement (can't fire on signers for the NAP duration).
- **Chat**: per-alliance, per-sector (public), global (rate-limited,
  moderated).
- **Trade**: player-to-player trade orders (`orderId`-keyed as usual).
  Spend credits, receive a target resource at a target colony.
  Requires an Orbital Docks tech unlock and hauler ships to actually
  move goods.

## 8. Anti-cheat / rate limiting / ops

### 8.1 Rate limits

Per-user token bucket keyed by Clerk subject id, implemented in
Postgres for v1 (one row per bucket, refilled on read). Enforce at the
order-endpoint layer:

- `/api/orders/*`: N submissions per minute
- `/api/home`: effectively one per account (idempotent)
- `/api/me`: 60 per minute per user (polling floor)

Move to Redis when we outgrow Postgres's refresh-every-read cost.

### 8.2 Server is the clock

Reinforcing from [`ARCHITECTURE.md §6`](../ARCHITECTURE.md):
clients never submit timestamps. All order scheduling uses `Date.now()`
on the server. Combat RNG seeds on `event_id` so a replay matches.

### 8.3 Admin tooling

- Dashboard to inspect / cancel events.
- Ban + soft-ban mechanism (blocks order submission, GDP frozen).
- Event table partitioned by month once it crosses ~10M rows
  (ARCHITECTURE scaling envelope).
- Backup + DR runbook (persistent universe has no "new season" escape
  hatch).

## 9. When to build what

Order informed by dependencies:

1. **Clerk (Chunk 4c)** — nothing else makes sense without real users.
2. **Rate limits + basic abuse protections** — one step after Clerk.
3. **Shared-galaxy slice in `/api/me`** — first visible multiplayer
   feature: seeing other players' colonies.
4. **Fog of war + sensors** — Chunk 9.
5. **Combat (Chunk 10)** — enables the reason to care about defender
   protections in §5.4 + §6.
6. **Offline shield + inactivity decay** — ship _with_ combat, not
   after.
7. **SSE + Redis (Chunk 7)** — when polling-latency hurts.
8. **Diplomacy / alliances / trade** — quality-of-life layer on top.
9. **Admin + ops** — continuous, escalates as active users grow.

## 10. Why it's deferred now

Per [ADR-009](./DECISIONS.md): single-player via the offline adapter
is the shortest path to a game that _feels like a game_. Once SP-1..5
ship and the core loop (mine → research → expand → watch GDP climb)
is satisfying on its own, we turn multiplayer on. Everything above is
ready to pick up.
