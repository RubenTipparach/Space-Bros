# Gameplay

Design doc for the game itself. Mechanics, buildings, tech, and the numbers
backing them. Balance is intentionally "first draft, decimal-place wrong" —
capture the intent, tune once the loop works end-to-end.

> Architecture / infra lives in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).
> This doc only covers **what the player experiences**.

## 1. Pitch in one sentence

Pick a home planet in a persistent galaxy, grow an economy across diverse
colonies, research your way up a tech tree, and build an interstellar
financial empire. Idle-paced: minutes-to-days of wall-clock time. Single-
player works standalone; multiplayer shares the same galaxy once auth is wired.

## 2. Core loop

1. **Pick home** — one habitable planet, one shot.
2. **Develop the colony** — queue mines / farms / trade hubs / labs /
   barracks. Buildings produce **local** resources (except trade hubs,
   which produce global **credits**).
3. **Grow population** — food produced locally plus planet biome determine
   growth; tech and building variety raise the cap.
4. **Research** — spend science (local, stockpiled at a colony) on techs
   that evolve each branch toward late-game megatech.
5. **Expand** — launch colony ships with metal + credits. Every new colony
   is a fresh stockpile to specialize.
6. **Aggregate** — trade hubs at every colony funnel local production into
   a single global credits pool; your **GDP** (credits/s) is the headline
   score.

The real tension: each colony is its own little economy that has to be
_self-sufficient_ for what it consumes locally, but specialized colonies
earn more credits by concentrating on what their biome does best.

## 3. Resources

**Credits (global)** — the only resource that lives at the empire level.
Earned by trade hubs; spent on ships, terraforming, and higher-tier
buildings. Credits are what GDP is measured in (see §9).

**Four per-colony resources:**

| Resource | Produced by     | Consumed by                           |
| -------- | --------------- | ------------------------------------- |
| Metal    | Mining          | Buildings, ships (launched from this colony) |
| Food     | Farming         | Population growth at this colony      |
| Science  | Science labs    | Research started at this colony       |
| Military | Barracks        | (MVP: score contribution; combat later)  |

Per-colony means: **the metal at colony A does not pay for a building at
colony B.** Each colony has its own four-accumulator stockpile. To build a
Mine III at your mining colony, that colony has to have enough metal on
hand. To start a research at a science colony, that colony has to have
enough science stockpiled.

**Transportation** (deferred past MVP; see §11): eventually, hauler ships
move resources between colonies at some cost. Until that lands, the design
nudges players to make each colony self-sufficient for what it consumes
(enough metal to keep building, enough food for its pop), and rewards
specialization via trade-hub credits conversion.

The single global credits pool means you _can_ shift economic weight
between colonies just by choosing where to build — a trade hub anywhere
funds a ship launched anywhere.

## 4. Population

Per-colony accumulator `(value, rate, t0)` plus a computed cap.

### 4.1 Cap formula

```
cap = biomeBase(biome)
    × techMultiplier(player)
    × varietyBonus(colony)
```

**Biome base** — the planet's raw carrying capacity. Gas and molten are
~zero; earthlike is ~25k.

| Biome      | Base     |
| ---------- | -------- |
| molten     | 500      |
| gas        | 0        |
| toxic      | 1 000    |
| ice        | 2 000    |
| rocky      | 3 000    |
| desert     | 5 000    |
| tundra     | 8 000    |
| jungle     | 20 000   |
| earthlike  | 25 000   |
| ocean      | 15 000   |

**Tech multiplier** — starts at 1.0. Habitat techs raise it globally:
`better_habitats` → ×1.5; `arcologies` → ×2.5; `megacities` → ×5.

**Variety bonus** — "need a variety of buildings to fill jobs." A colony
with only one type of building supports a basic population; having all
five types (mining + farming + trading + science + warfare) doubles the
cap.

| Distinct building types | Variety multiplier |
| ----------------------- | ------------------ |
| 0 or 1                  | 0.5                |
| 2                       | 1.0                |
| 3                       | 1.3                |
| 4                       | 1.6                |
| 5                       | 2.0                |

### 4.2 Growth

Pop grows toward cap when food production meets consumption.

- **Food consumption** = `pop / 10 000` food/s. (10k pop ≈ 1 food/s.)
- **Base growth rate** = `0.05 × habitability` pop/s at the colony.
- **Effective growth rate** = `baseGrowth × clamp(foodProduced / foodConsumed, 0, 1.5)`.
  - Surplus food accelerates growth (up to 1.5× bonus).
  - Starvation (food < consumption) halts growth at zero.
  - v1: no population decay below consumption — pop just stops. Revisit.

Pop above cap is impossible in v1 — growth clamps at cap. (Future: soft
overflow with decay.)

## 5. Buildings

Five types, three tiers each. One build slot per colony in MVP (parallel
queues come later).

**Every building produces exactly one resource.** Exception: trade hubs
produce credits (the global resource), and their output is boosted by the
colony's _variety_ — a lonely trade hub in a one-building colony earns
little, a trade hub in a full-spectrum colony earns a lot.

Tier 2 and Tier 3 require **prereq tech + prereq building tier** at the
same colony.

### 5.1 Tier matrix

All times are real-world seconds. Costs use L prefix for "local" (metal,
food, science, military at _this_ colony) and G for "global" (credits).

| Building  | Tier 1                                  | Tier 2                                  | Tier 3                                      | Unlock (T2 / T3)            |
| --------- | --------------------------------------- | --------------------------------------- | ------------------------------------------- | --------------------------- |
| Mine      | 50 L-metal, 30 s, **+0.5 metal/s**      | 150 L-metal + 50 G-credits, 90 s, **+1.5 metal/s**   | 400 L-metal + 200 G + 80 L-food, 5 m, **+4 metal/s** | Mining I / Mining II        |
| Farm      | 40 L-metal, 30 s, **+0.3 food/s**       | 120 L-metal + 40 G, 90 s, **+1 food/s**              | 320 L-metal + 160 G, 5 m, **+3 food/s**              | Agriculture I / Agriculture II |
| Trade hub | 80 L-metal, 60 s, **+0.1 × variety credits/s** | 240 L-metal + 80 G, 3 m, **+0.4 × variety credits/s** | 640 L-metal + 320 G, 10 m, **+1.5 × variety credits/s** | Commerce I / Commerce II    |
| Lab       | 80 L-metal + 20 L-food, 60 s, **+0.5 science/s** | 240 L-metal + 60 L-food + 80 G, 3 m, **+1.5 science/s** | 640 L-metal + 160 L-food + 320 G, 10 m, **+4 science/s** | Scientific Method / Computing |
| Barracks  | 100 L-metal, 60 s, **+0.3 military/s**  | 300 L-metal + 100 G, 3 m, **+1 military/s**         | 800 L-metal + 400 G, 10 m, **+3 military/s**        | Drill / Logistics           |

"Variety" in the trade-hub formula = the colony's variety multiplier from
§4.1 (0.5 to 2.0). A trade-hub-only colony earns 0.05 credits/s from a Tier 1;
a fully diversified colony earns 0.2 from the same building.

### 5.2 Starting baseline (no buildings)

When a player founds their home colony, the colony starts with a small
baseline so it isn't paralysed pre-buildings:

- +1 metal/s, +0.5 food/s, +0.3 science/s at the home colony itself.
- +0.1 credits/s global (so the player has a trickle of credits to pay for
  their first Tier-2 anything).
- Outposts (non-home colonies) start with **zero** baseline — you build
  them up manually.

## 6. Tech tree

Five branches, matching the five building types. Each branch evolves from
basic ("let's dig ore") through mid-tier ("run this better") to exotic
late-game ("orbital megastructures"). ~3–4 techs per branch; MVP is 16.

### 6.1 Mining branch

1. **Mining I** — unlocks Mine II. _100 science, 2 m._
2. **Mining II** — unlocks Mine III. _400 science, 8 m._ Prereq: Mining I.
3. **Asteroid Mining** — lets Mines run on gas / molten / toxic worlds
   (orbital platforms). _600 science + 200 credits, 10 m._ Prereq: Mining II.

### 6.2 Farming branch

4. **Agriculture I** — unlocks Farm II. _100 science, 2 m._
5. **Agriculture II** — unlocks Farm III, +25% biome base everywhere.
   _400 science, 8 m._ Prereq: Agriculture I.
6. **Bigger Colony Ships** — colony ships carry ×2 colonists. _200 science, 5 m._
7. **Terraforming I** — unlocks the terraform action (raise a planet's
   biome by one step over 20 m real time). _500 science + 200 credits, 10 m._
   Prereq: Agriculture II.

### 6.3 Trading branch

8. **Commerce I** — unlocks Trade Hub II. _120 science, 2 m._
9. **Commerce II** — unlocks Trade Hub III. _500 science, 10 m._ Prereq: Commerce I.
10. **Orbital Docks** — unlocks **Hauler Ship** and therefore
    inter-colony transport. _700 science + 400 credits, 15 m._ Prereq:
    Commerce II.

### 6.4 Science branch

11. **Scientific Method** — unlocks Lab II. _150 science, 3 m._
12. **Computing** — unlocks Lab III. _600 science, 12 m._ Prereq: Scientific Method.
13. **Automation** — all buildings finish 25% faster. _300 science + 100 credits, 6 m._
    Prereq: Mining I + Scientific Method.

### 6.5 Warfare branch

14. **Drill** — unlocks Barracks II, unlocks **Faster Ships I** (×0.75
    travel time). _120 science, 2 m._
15. **Logistics** — unlocks Barracks III, unlocks **Faster Ships II**
    (additional ×0.75). _500 science, 10 m._ Prereq: Drill.
16. **Space Stations** — unlocks the **Space Station** building (treated as
    a "super-tier" variant that occupies no ground slot — big defensive
    bonus + passive credits). _800 science + 500 credits, 20 m._
    Prereq: Logistics + Commerce II.

Techs are per-player (global), even though _research_ is started at a
colony using that colony's local science stockpile.

## 7. Ships

MVP ships:

- **Colony ship** — 200 local metal + 100 global credits. Delivers 1000
  colonists (×2 with Bigger Colony Ships). Consumed on arrival.

Deferred (§11):

- **Hauler ship** — moves resources between two colonies. Unlocked by
  Orbital Docks. Capacity scales with research.
- **Scout** — reveals sector contents (pairs with sensors tech).
- **Frigate / destroyer / capital** — combat (Chunk 10).

## 8. Travel

Unchanged from ADR-005: base speed 5 minutes per light-year. Modifiers:

- `faster_ships_1` → ×0.75
- `faster_ships_2` → ×0.75

Galaxy coordinates are light-years (disk radius ~500 ly).

## 9. Empire score — GDP

**GDP is the main number.** It is the current **aggregate credits/s
across all colonies** of a single player. That one value is the score; it
grows with trade hubs, colony count, building variety, and tech.

```
GDP = sum over colonies of (trade-hub output at that colony)
```

Where each trade hub contributes `rate × variety`, so diverse colonies
punch way above their building count.

Displayed in the HUD as, e.g., `GDP 12.4 credits/s (748/min)`. Milestones
fire at 1 / 10 / 100 / 1k / 10k credits/s. No victory condition — the
number grows forever.

Lifetime credits (a running total) is the prestige/bragging-rights stat,
visible but secondary.

## 10. Balance targets (first draft)

Rough intended session shape:

| Elapsed real time | Expected state                                                  |
| ----------------- | --------------------------------------------------------------- |
| 5 minutes         | Home colony, 1 mine + 1 farm queued.                            |
| 30 minutes        | Mining I or Agriculture I researched, 4–5 Tier-1 buildings.     |
| 2 hours           | 2 buildings of each type, credits trickle from trade hub.       |
| 1 day             | 3 colonies, variety bonus at cap on capital, Tier-2 unlocks.    |
| 1 week            | 10+ colonies, specialization pays off, full Tier-2, Tier-3 work.|
| ~2 weeks          | Late-game toys: terraforming, space stations, orbital docks.    |

Early-game: minutes-scale. Mid-game: hours-scale. Late-game: full idle.

## 11. What's explicitly out of scope for the MVP

- **Inter-colony transport / hauler ships.** Placeholder: each colony
  self-sufficient. Design the data model to support per-colony stockpiles
  _today_ so the transport layer drops in cleanly later.
- Diplomacy, chat, alliances, trade between players.
- Ship combat / destroyable fleets (Chunk 10).
- Building upkeep costs (T3 buildings later need credits/s upkeep).
- Seasonal prestige, loot, paid anything.

## 12. Open questions (pinging the doc so we don't lose them)

- **Variety formula numbers** — does 0.5/1.0/1.3/1.6/2.0 feel right? Or
  should single-type colonies be punished harder (e.g. 0.25)?
- **Starvation penalty** — current: growth halts at zero. Alternative:
  slow decay toward a "starvation floor." Added stakes, more annoying.
- **Baseline credits** (+0.1 at home) — is that necessary or does it
  remove the drive to build a trade hub? Maybe drop and force players to
  build one to unlock non-metal purchases.
- **Orbital mining on gas giants** — just mines behaving as normal, or a
  new building type? Simpler: normal mines with a tech gate.
- **Building cost scaling by tier of prior level** — currently flat "T2
  costs 3× T1". Fine, or scale by your current empire size?
- **Barracks pre-combat** — Military stockpile ticks up with no use.
  Score contributor only? Or give it something to do now (e.g., reduces
  colony-ship loss on hostile planets, which we can define later)?
