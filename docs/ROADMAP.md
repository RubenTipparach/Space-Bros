# Roadmap

Where we are, the shortest path to a playable single-player game, and
what's parked for later.

## What works today

Per [`../README.md`](../README.md) chunk plan:

- ✅ Chunk 0 — Repo scaffold (pnpm workspace, Next.js app, shared lib)
- ✅ Chunk 1 — Deterministic galaxy generator
- ✅ Chunk 2 — Three.js viewer with touch-friendly controls
- ✅ Chunk 3 — Pure sim reducer (`processEvent`, `advanceTo`)
- ✅ Chunk 4a — Drizzle schema + migrations
- ✅ Chunk 4b — Dev-cookie auth, `/api/me`, home-planet picker
- ✅ Chunk 5 — `/api/tick` cron drain with `FOR UPDATE SKIP LOCKED`
- ✅ Chunk 6a — `/api/orders/research`
- ✅ Chunk 6b — `/api/orders/launch` (colony ships, 5 min/ly travel)
- ✅ Offline mode + GitHub Pages deployment (single-player works today)

You can pick a home, research sensor tech, launch a colony ship, wait for
it to land, and see a second colony appear. **No buildings with real
effects, no tech effects beyond travel + colonists, no score, no UI
feedback for progression.** That's what's next.

## Shortest path to playable single-player

The MVP goal: a player sits down for a few hours and has something that
feels like a game — growing economy, meaningful decisions, visible
progress, endgame they can chase. Everything below is scoped to the
offline adapter too (`OfflineApi` mirrors every new rule).

### Milestone SP-1 · Per-colony economy + buildings (Chunk 6c)

**Biggest unlock** — and the biggest refactor. The design shift from ADR-012
(credits global, everything else per-colony) means the data model changes
_before_ the building catalog lands. Breaking into two sub-milestones so we
can ship each independently.

#### SP-1a · Data-model migration to per-colony resources

- [ ] New Drizzle schema: `colony_resources` table with metal / food /
      science / military accumulator columns keyed by `colony_id`.
      Drop the three science/energy/metal columns from `player_resources`;
      keep it as `player_credits` (or move credits onto `players`).
- [ ] `OfflineApi` state shape: each colony carries its own stockpile,
      plus one empire-level `credits` accumulator.
- [ ] `/api/me` returns per-colony resources and global credits.
- [ ] `foundHomeColony` / offline `pickHome` seed the starting per-colony
      rates (§5.2 baseline) and bootstrap credits.
- [ ] `deductResources` in `lib/db/orders.ts` + offline equivalent take a
      `colonyId` and read/write that colony's row.
- [ ] Existing orders adjusted:
      - Research: deducts local science at the colony you're researching at.
        Requires picking a colony when starting research.
      - Launch: deducts local metal at the source colony + global credits.

_Size: ~1 session. Entirely plumbing; no new gameplay surface._

#### SP-1b · Building catalog + UI

- [ ] `packages/shared/src/gamedata.ts` grows the 5 building definitions
      × 3 tiers with costs/times/effects per [`GAMEPLAY.md §5`](./GAMEPLAY.md).
- [ ] `POST /api/orders/build` — `{ orderId, colonyId, buildingType }`.
      Idempotent; deducts local resources + global credits; schedules
      `building_complete`.
- [ ] `applyBuildingComplete` in both `lib/db/tick.ts` AND
      `lib/api/offline.ts` bumps the building level + rebases **that
      colony's** relevant accumulator with the new rate. Variety bonus
      recomputed for pop cap.
- [ ] Population: cap = biomeBase × techMultiplier × varietyBonus (§4.1),
      growth gated by local food production vs consumption (§4.2).
- [ ] **Per-colony panel**: select a colony, see its stockpiles,
      buildings by type × tier, pop vs cap, variety multiplier, and a
      queue for the next build. Progress bar for in-flight builds.
- [ ] Trade-hub credits output scales with colony variety.
- [ ] GDP number in the HUD (sum of trade-hub outputs).

_Size: ~2 sessions._ The per-colony panel is the biggest UI piece we've
added so far.

### Milestone SP-2 · Real tech tree (Chunk 8)

Current 5 placeholder techs → 16 techs across 5 branches per
[`GAMEPLAY.md §6`](./GAMEPLAY.md).

- [ ] Expand `gamedata.ts` TECHS to 16 entries across 5 branches (mining
      / farming / trading / science / warfare), with concrete costs,
      durations, prereqs, and effect tags.
- [ ] Tech effects applied in both reducers:
      - Building-tier unlocks (Mining I → Mine II, etc.) — just a data
        lookup in the build-order validator.
      - **Automation** → 25% building-time multiplier.
      - **Agriculture II** → +25% biome base cap globally.
      - **Bigger Colony Ships** / **Faster Ships I/II** (already coded).
      - **Asteroid Mining** — mines allowed on gas / molten / toxic biomes.
      - **Terraforming I** — unlocks the terraform action (→ SP-3).
      - **Orbital Docks** — unlocks hauler ships (see §11 in GAMEPLAY;
        deferred until after MVP).
      - **Space Stations** — unlocks the Space Station building.
- [ ] Research tree visualization: group by branch, show prereqs,
      highlight unlockable vs locked. DAG view is stretch.

_Size: ~1 session if we stay disciplined about effects._

### Milestone SP-3 · Terraform orders (Chunk 6c-2)

- [ ] `POST /api/orders/terraform` — pick colony + target biome, spend
      science + energy, schedule `terraform_complete`.
- [ ] `applyTerraformComplete` already exists in the DB mirror; verify
      offline mirror. Writes `planet_overlays` row.
- [ ] UI: on your own colony, if `terraform_basics` researched and biome
      ≠ earthlike, show a "Terraform to X" action.

_Size: half a session._

### Milestone SP-4 · Progression + feel

The difference between "tech demo" and "game."

- [ ] **GDP** in the HUD (credits/s across all trade hubs), per
      [`GAMEPLAY.md §9`](./GAMEPLAY.md). Live-ticking. Lifetime credits
      beside it as secondary stat.
- [ ] **Milestone toasts** — first colony, first Tier-2 building, first
      GDP thresholds (1 / 10 / 100 / 1k credits/s), all starter techs.
- [ ] **Travel preview** in SystemView — distance + ETA before the player
      clicks Launch.
- [ ] **Colonies list** panel (collapsed by default) — one row per colony,
      population + resource rates + biome, click to focus the Three.js
      camera on it.
- [ ] **Own colonies on the galaxy map** — coloured dots / ring on your
      stars.

_Size: 1 session; individually any of these is small._

### Milestone SP-5 · Onboarding + polish

- [ ] A one-screen intro modal on first launch ("Space Bros — pick a habitable
      planet to begin") that dismisses after home pick.
- [ ] Offline-mode **export/import save** — JSON download + paste to load.
      Lets players back up or share a state.
- [ ] Reset-save confirmation is there; add "new galaxy seed" option.
- [ ] Sound effects (stretch, probably don't).

_Size: half a session._

### When we can honestly say "single-player MVP shipped"

All five milestones landed. A player can go from zero → 10 colonies →
entire tech tree over a few sessions of play. Score number goes up.

## Post-MVP (parked until SP-1..5 done)

All deliberately deferred per [`DECISIONS.md ADR-009`](./DECISIONS.md):

- **Chunk 4c — real Clerk auth.** Unblocks multiplayer.
- **Chunk 7 — SSE push.** Requires Redis. Polling stays fine for idle.
- **Chunk 9 — multiplayer interactions.** Fog of war, outposts on shared
  planets, cross-player visibility.
- **Chunk 10 — combat.** Fleet encounters, seeded RNG resolver, fleet-vs-fleet.
- **Persistent-universe fairness** (ARCHITECTURE §9): catch-up ramps,
  sanctuary sectors, offline shield, inactivity decay, sliding leaderboards.
- **Chunk 11 — PWA polish.** Manifest, service worker, web push.
- **Ops** — rate limiting, admin dashboard, events partitioning, monitoring,
  tests for DB + route handlers + cross-impl parity.
- **Ship variety** — scouts, frigates, destroyers (tied to combat).
- **Diplomacy / chat / alliances.**
- **Trade between players.**

## Known tech debt / risks

- **Three implementations of sim semantics** — pure reducer in
  `@space-bros/shared`, DB mirror in `lib/db/tick.ts`, offline mirror in
  `lib/api/offline.ts`. First real drift bug is inevitable; mitigation is
  cross-impl property tests. (ADR-008.)
- **No tests below the shared lib.** DB queries, route handlers, and the
  offline API all untested. Easiest wins: offline API (pure-ish).
- **`/api/home` and `/api/orders/launch` both create colony rows** via
  slightly different paths. Consider consolidating through the
  `colony_founded` event for symmetry when SP-1 lands.

## Open design calls (tune before final numbers land)

All the _structural_ calls are locked in via ADRs-011..015. Remaining open
items are just numbers:

- **Variety bonus curve** — is 0.5/1.0/1.3/1.6/2.0 right, or should
  mono-culture colonies be punished harder? ([GAMEPLAY §12](./GAMEPLAY.md))
- **Starvation penalty** — halt growth (current) vs. decay toward a floor.
- **Starting credits baseline** (+0.1/s at home) — helpful or does it
  blunt the drive to build the first trade hub?
- **Barracks pre-combat** — Military stockpile just ticks up for score
  until Chunk 10 lands, or does it need a near-term use?
