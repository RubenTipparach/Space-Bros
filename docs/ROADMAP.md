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

### Milestone SP-1 · Real economy (Chunk 6c)

**Biggest unlock.** Buildings currently increment a counter with no
effect. This chunk makes them actually do what the name says.

- [ ] Building catalog in `packages/shared/src/gamedata.ts` per
      [`GAMEPLAY.md §5`](./GAMEPLAY.md).
- [ ] `POST /api/orders/build` — queue a building at a colony
      (idempotent, deducts resources, schedules `building_complete`).
- [ ] `applyBuildingComplete` in both `lib/db/tick.ts` AND `lib/api/offline.ts`
      recomputes the player's resource rates. The accumulator needs a
      rebase (`rate * elapsed` locked in before changing rate).
- [ ] Population cap on colonies, raised by habitat buildings.
- [ ] Per-colony UI: select a colony, see its buildings, queue a new one,
      show progress bar for in-flight builds.

_Size: ~1–2 sessions._ Mostly code (the schema already supports it).

### Milestone SP-2 · Real tech tree (Chunk 8)

Current 5 techs are placeholders. Expand to 14 (per
[`GAMEPLAY.md §6`](./GAMEPLAY.md)) with actual effects.

- [ ] Expand `gamedata.ts` TECHS to 14 entries across 3 branches.
- [ ] Tech effects applied in both reducers:
      - "Mining I" → unlocks Mine II (data lookup; no runtime effect,
        just gating in the build UI).
      - "Automation" → multiplier on `building_complete` durations.
      - "Faster Ships II" → additional ×0.75 to travel.
      - "Sensors I/II" → reveal distance (client-side render only for v1).
      - "Terraforming I" → unlock terraform action.
- [ ] Research tree visualization (simple: group by branch, show
      prereqs, highlight unlockable). A DAG view is stretch.

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

- [ ] **Empire score** in the HUD (formula from
      [`GAMEPLAY.md §9`](./GAMEPLAY.md)), live-ticking.
- [ ] **Milestone toasts** — first colony, first Tier-2, all starter techs, etc.
- [ ] **Travel preview** in SystemView — show distance + ETA before the
      player clicks Launch.
- [ ] **Colonies list** panel (collapsed by default) — one row per colony,
      population + rate + biome, click to focus in Three.js.
- [ ] **Own colonies on the galaxy map** — coloured dots / ring on your stars.

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

## Open design calls (need user input before building)

- **Building catalog numbers** — see [`GAMEPLAY.md §5`](./GAMEPLAY.md).
  Rough draft, want a pass before the code hard-codes them.
- **Per-colony stockpiles vs global pool** — [`GAMEPLAY.md §3`](./GAMEPLAY.md)
  assumes global. Confirm or override.
- **Population caps** — do we decay above cap, or just stop growing?
  Current spec says "stop growing." (`[§12](./GAMEPLAY.md).)
- **Empire score formula** — placeholder in GAMEPLAY.md §9. Any tuning
  before it becomes the visible number?
