# Gameplay

Design doc for the game itself. Mechanics, buildings, tech, and the numbers
backing them. Balance is intentionally "first draft, decimal-place wrong" —
capture the intent, tune once the loop works end-to-end.

> Architecture / infra lives in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).
> This doc only covers **what the player experiences**.

## 1. Pitch in one sentence

Pick a home planet in a persistent galaxy, grow an economy, research your way
up a tech tree, and colonize the stars. Idle-paced: minutes-to-days of
wall-clock time. Single-player works standalone; multiplayer shares the same
galaxy once auth is wired.

## 2. Core loop

1. **Pick home** — one habitable planet, one shot.
2. **Build** — queue mines / power / labs / habitats at a colony. Each one
   finishes in wall-clock time and raises a rate.
3. **Research** — spend science on techs that multiply rates, unlock buildings,
   faster ships, terraforming.
4. **Expand** — launch a colony ship to a target star. Travel takes minutes
   to days depending on distance and speed.
5. **Repeat.** Scale wins: ten colonies pulling resources feed research,
   which unlocks bigger colony ships and more colonies, which feed research…

The ceiling on progress is _real time_, not clicks. Players close the tab
and come back to a larger empire.

## 3. Resources

Three currencies, stored as `(value, rate, t0)` accumulators:

| Resource | Sources                                          | Sinks                      |
| -------- | ------------------------------------------------ | -------------------------- |
| Metal    | Mines, home colony baseline                      | Buildings, ships           |
| Energy   | Power plants, home colony baseline, reactor tech | Buildings, ships, upkeep   |
| Science  | Research labs, home colony baseline              | Research, terraforming     |

Starting rates (from picking home): **1 metal/s · 0.5 energy/s · 0.5 science/s**.
These are the _baseline_ from the capital itself; buildings add on top.

No per-colony stockpiles in v1. Resources are **a single global pool per
player**, refilled by every colony. (Keeps the UI trivially simple; revisit
if logistics becomes a mechanic.)

## 4. Population

Per-colony accumulator. Also `(value, rate, t0)`, with a `cap`.

- Growth rate = `0.05 × habitability` per second (earthlike ≈ 0.05 pop/s).
- Below `HABITABLE_MIN_HABITABILITY = 0.2`, rate is **0** — this is what makes
  a planet an "outpost." It exists, contributes via buildings, but doesn't
  grow population. Terraforming unlocks growth.
- Cap starts at **1000**, raised by Habitat buildings (+5000 per level).

## 5. Buildings

**v1 catalog** — four types, three tiers each. Tier N requires the Tier N-1
of the same type, plus a tech unlock for Tier 2 and Tier 3.

Each level instance is queued at one colony. One build at a time per colony
(v1; later: parallel queue per tier). Build completes → rate recomputed for
the whole player.

| Building       | Effect per level           | Cost (T1 → T2 → T3) | Time (T1/T2/T3) | Unlock (T2/T3)         |
| -------------- | -------------------------- | ------------------- | --------------- | ---------------------- |
| Mine           | +0.5 / +1.5 / +4 metal/s   | 50M/20E → 150M → 400M/100E | 30s / 90s / 4m | `mining_i` / `mining_ii` |
| Power plant    | +0.5 / +1.5 / +4 energy/s  | 40M → 120M → 320M/40E | 30s / 90s / 4m | `fusion_i` / `fusion_ii` |
| Research lab   | +0.5 / +1.5 / +4 science/s | 80M/40E → 240M/120E → 640M/320E/80S | 60s / 3m / 8m | `scientific_method` / `computing` |
| Habitat        | +5000 / +15000 / +40000 pop cap | 100M/20E → 300M/60E → 800M/160E | 60s / 3m / 8m | `better_habitats` / `arcologies` |

Building effect is **global to the player**, not per-colony. A mine at a
dusty outpost adds to the same metal pool as one at home.

## 6. Tech tree

Three branches. Each branch has three tiers. Each tech takes linearly
more science + time as you go up.

### 6.1 Economy

- **Mining I** — unlocks Mine II. _100 science, 2 min._
- **Mining II** — unlocks Mine III. _400 science, 8 min._ Prereq: Mining I.
- **Fusion I** — unlocks Power Plant II. _100 science, 2 min._
- **Fusion II** — unlocks Power Plant III. _400 science, 8 min._ Prereq: Fusion I.
- **Automation** — all buildings finish 25% faster. _300 science, 6 min._
  Prereq: Mining I + Fusion I.

### 6.2 Science + population

- **Scientific Method** — unlocks Research Lab II. _120 science, 2 min._
- **Computing** — unlocks Research Lab III. _500 science, 10 min._
  Prereq: Scientific Method.
- **Better Habitats** — unlocks Habitat II. _150 science, 3 min._
- **Arcologies** — unlocks Habitat III. _600 science, 12 min._ Prereq: Better Habitats.
- **Terraforming I** — unlock terraform action: raises hab by +0.2 on one
  planet over 20 min. _500 science + 200 energy, 10 min research._
  Prereq: Scientific Method + Fusion I.

### 6.3 Fleet

- **Faster Ships I** — ×0.75 travel time. _100 science, 2 min._ *(already in code)*
- **Bigger Colony Ships** — ×2 colonists per ship. _200 science, 5 min._ *(already in code)*
- **Faster Ships II** — additional ×0.75 travel. _400 science, 8 min._ Prereq: Faster Ships I.
- **Sensors I** — see neighbours within 50 ly (v1: just lights up more stars
  on the map). _80 science, 90s._
- **Sensors II** — 150 ly, plus reveals fleet ETAs of enemies. _250 science, 5 min._
  Prereq: Sensors I.

**Total v1: 14 techs** across three branches. Enough for a ~1–3 hour loop to
get through Tier-2 everything; all-tech-researched should take ~8–12 hours of
active-ish play plus several days of idle.

## 7. Ships

v1 ships the **colony ship** only.

- **Colony ship** — 200 metal + 100 energy, delivers 1000 colonists (2000
  with `bigger_colony_ships_1`), one-shot (consumed on arrival).
- Future: scout, frigate, destroyer (Chunk 10 when combat exists).

Ships exist as a _fleet_ (grouping), not individual units. A fleet is
`{ ships: Record<ShipId, number>, from, to, departAt, arriveAt }`.

## 8. Travel

Base speed: **5 minutes per light-year**. Galaxy coordinates _are_ ly
(disk radius ~500 ly).

Modifiers stack multiplicatively:
- `faster_ships_1` → ×0.75
- `faster_ships_2` → ×0.75

(Both → 5 × 0.75 × 0.75 ≈ 2.8 min/ly.)

No real-time fleet combat in transit; fleets are invulnerable until arrival.
(This changes in Chunk 10 — "combat" events on path intersections.)

## 9. Goals / single-player victory

No hard win condition; this is an idle game. Progression hooks:

1. **Milestones** — popup toasts for first colony, first Tier-2 building,
   first Tier-3 colony, all techs researched, 10 colonies, 100M total pop.
2. **Empire score** — a single number in the HUD derived from
   `population + buildings × 100 + techs × 500 + colonies × 1000`. Visible,
   but not gating anything. "Watch it tick up" is the hook.
3. **Achievements** (stretch) — permanent badges that survive resets.

We intentionally avoid "galactic domination" as the win because persistent
multiplayer exists — one player "winning" makes the game worse for everyone
else.

## 10. Balance targets

Rough intended session shape, before tuning:

| Elapsed real time | Expected state                                    |
| ----------------- | ------------------------------------------------- |
| 5 minutes         | Home colony founded, 1 mine queued.               |
| 30 minutes        | Mining I researched, 2–3 Tier-1 buildings done.   |
| 2 hours           | First colony ship launched to nearest neighbour.  |
| 1 day             | 3 colonies, Tier-2 unlocks coming online.         |
| 1 week            | 10+ colonies, full Tier-2, working through Tier-3. |

Early-game should reward engagement — builds finish in minutes so "do a
thing, come back in 10 minutes" is rewarded. Mid-game (Tier-2) shifts to
"check in a few times a day." Late-game is full idle.

## 11. What's explicitly out of scope for the MVP

- Diplomacy, chat, alliances
- Trade between players
- Ship combat / destroyable fleets
- Multi-colony resource logistics (pools are global)
- Planetary specialization beyond biome
- Seasons / prestige
- Loot / drops / RNG rewards
- Paid anything

All interesting. All later.

## 12. Open questions (pinging the doc here so we don't lose them)

- Habitat cap: does population-above-cap decay, or just stop growing? (v1: stop.)
- What happens if you lose your home? Currently nothing — another colony just
  becomes the effective capital. Probably fine.
- Outposts below 0.2 hab: _do_ they still take a colony-ship worth of metal?
  Yes (same cost, worse outcome — intentional).
- Do buildings consume energy upkeep, or is energy free once produced?
  v1: free. Revisit when late-game energy feels too abundant.
