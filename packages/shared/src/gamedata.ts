import type { Biome } from "./galaxy.ts";
import type { TechId } from "./state.ts";

/**
 * Minimal starter tech tree. Balance is intentionally rough — Chunk 8
 * expands this into a real research tree with prereqs and tiers.
 *
 * Costs are keyed against `ResourceCost` below.
 * Durations are in **seconds** (real time).
 */

export interface TechDef {
  id: TechId;
  name: string;
  description: string;
  cost: ResourceCost;
  durationSeconds: number;
  prereqs: TechId[];
}

export const TECHS: Record<string, TechDef> = {
  sensors_1: {
    id: "sensors_1",
    name: "Long-range Sensors",
    description: "See further into neighbouring systems.",
    cost: { science: 40 },
    durationSeconds: 60,
    prereqs: [],
  },
  scientific_method: {
    id: "scientific_method",
    name: "Scientific Method",
    description: "Placeholder — SP-2 expands the science branch.",
    cost: { science: 60 },
    durationSeconds: 90,
    prereqs: [],
  },
  faster_ships_1: {
    id: "faster_ships_1",
    name: "Faster Ships I",
    description: "+25% travel speed for all fleets.",
    cost: { science: 80 },
    durationSeconds: 150,
    prereqs: [],
  },
  bigger_colony_ships_1: {
    id: "bigger_colony_ships_1",
    name: "Bigger Colony Ships",
    description: "Colony ships carry 2× colonists.",
    cost: { science: 120 },
    durationSeconds: 240,
    prereqs: [],
  },
  terraform_basics: {
    id: "terraform_basics",
    name: "Terraforming Basics",
    description: "Unlocks terraforming adjacent biomes.",
    cost: { science: 200, credits: 100 },
    durationSeconds: 420,
    prereqs: ["scientific_method"],
  },
};

export function getTech(id: string): TechDef | undefined {
  return TECHS[id];
}

export function listTechs(): TechDef[] {
  return Object.values(TECHS);
}

/**
 * Resource costs. Credits is the only global resource (ADR-012);
 * metal/food/science/military are per-colony stockpiles.
 */
export interface ResourceCost {
  /** per-colony */
  metal?: number;
  /** per-colony */
  food?: number;
  /** per-colony */
  science?: number;
  /** per-colony */
  military?: number;
  /** global */
  credits?: number;
}

/** Resource keys, useful for iterating. */
export const PER_COLONY_RESOURCES = ["metal", "food", "science", "military"] as const;
export type PerColonyResource = (typeof PER_COLONY_RESOURCES)[number];

/**
 * Per §5.2 of GAMEPLAY.md: when a player founds their home colony,
 * that colony starts with these per-colony rates and a small global
 * credits trickle. Outposts (non-home colonies) start with all zero
 * rates — buildings light them up.
 */
export const HOME_COLONY_RESOURCE_RATES = {
  /** per-colony, applied to the home colony itself */
  metalPerSecond: 1.0,
  foodPerSecond: 0.5,
  sciencePerSecond: 0.3,
  militaryPerSecond: 0,
  /** global */
  creditsPerSecond: 0.1,
} as const;

// ---- Travel + colonization ------------------------------------------------

/**
 * Galaxy coordinates are light-years. Base travel speed is a constant
 * minutes-per-ly; research modifies it multiplicatively. 5 min/ly at
 * base gives: nearest-neighbor hops in minutes, sector trips in an
 * hour or two, cross-galaxy expansion in days. Tune freely.
 */
export const BASE_MINUTES_PER_LIGHT_YEAR = 5;

/**
 * Colony ship cost paid at launch. Local metal at the source colony
 * plus global credits.
 */
export const COLONY_SHIP_COST: ResourceCost = { metal: 200, credits: 100 };

/** Base colonists delivered per colony ship. */
export const BASE_COLONISTS = 1000;

/** Speed multipliers applied by research (stacked multiplicatively). */
export const SPEED_MODIFIERS: Record<string, number> = {
  faster_ships_1: 0.75,
};

/** Colonist multipliers applied by research (stacked multiplicatively). */
export const COLONIST_MODIFIERS: Record<string, number> = {
  bigger_colony_ships_1: 2,
};

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function distanceLy(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export interface TravelEstimate {
  distanceLy: number;
  durationMs: number;
  multiplier: number;
}

export function travelEstimate(
  distLy: number,
  completedTechs: ReadonlySet<string>,
): TravelEstimate {
  let multiplier = 1.0;
  for (const [techId, mod] of Object.entries(SPEED_MODIFIERS)) {
    if (completedTechs.has(techId)) multiplier *= mod;
  }
  const minutes = distLy * BASE_MINUTES_PER_LIGHT_YEAR * multiplier;
  return {
    distanceLy: distLy,
    durationMs: Math.max(1000, Math.round(minutes * 60_000)),
    multiplier,
  };
}

export function colonistsForShip(completedTechs: ReadonlySet<string>): number {
  let n = BASE_COLONISTS;
  for (const [techId, mod] of Object.entries(COLONIST_MODIFIERS)) {
    if (completedTechs.has(techId)) n *= mod;
  }
  return n;
}

/**
 * Habitable planet: supports a standard colony with population growth.
 * Below this threshold a colony still founds but grows at 0 (outpost).
 */
export const HABITABLE_MIN_HABITABILITY = 0.2;

export function populationRateForBiome(habitability: number): number {
  if (habitability < HABITABLE_MIN_HABITABILITY) return 0;
  // Gentle curve: a perfect earthlike grows ~5× an edge-of-hab tundra.
  return 0.05 * Math.max(0, habitability);
}

// ---- Buildings (SP-1b.1) --------------------------------------------------

export type BuildingType = "mine" | "farm" | "trade_hub" | "lab" | "barracks";
export const BUILDING_TYPES: readonly BuildingType[] = [
  "mine",
  "farm",
  "trade_hub",
  "lab",
  "barracks",
] as const;

export interface BuildingTierDef {
  cost: ResourceCost;
  durationSeconds: number;
  /** Tech that unlocks this tier (T1 has no unlock requirement). */
  unlockTech?: TechId;
  /**
   * Resource production. For mine/farm/lab/barracks: per-second of the
   * matching per-colony resource. For trade_hub: credits/s _before_ the
   * colony's variety multiplier is applied.
   */
  perSecond: number;
}

export interface BuildingDef {
  type: BuildingType;
  name: string;
  description: string;
  /** Index 0 = Tier 1, etc. */
  tiers: BuildingTierDef[];
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  mine: {
    type: "mine",
    name: "Mine",
    description: "Extracts metal from the local rock.",
    tiers: [
      { cost: { metal: 50 }, durationSeconds: 30, perSecond: 0.5 },
      {
        cost: { metal: 150, credits: 50 },
        durationSeconds: 90,
        perSecond: 1.5,
        unlockTech: "mining_i",
      },
      {
        cost: { metal: 400, credits: 200, food: 80 },
        durationSeconds: 300,
        perSecond: 4,
        unlockTech: "mining_ii",
      },
    ],
  },
  farm: {
    type: "farm",
    name: "Farm",
    description: "Feeds the population and lifts the cap.",
    tiers: [
      { cost: { metal: 40 }, durationSeconds: 30, perSecond: 0.3 },
      {
        cost: { metal: 120, credits: 40 },
        durationSeconds: 90,
        perSecond: 1,
        unlockTech: "agriculture_i",
      },
      {
        cost: { metal: 320, credits: 160 },
        durationSeconds: 300,
        perSecond: 3,
        unlockTech: "agriculture_ii",
      },
    ],
  },
  trade_hub: {
    type: "trade_hub",
    name: "Trade Hub",
    description: "Sells the colony's surplus into credits. Output × variety.",
    tiers: [
      { cost: { metal: 80 }, durationSeconds: 60, perSecond: 0.1 },
      {
        cost: { metal: 240, credits: 80 },
        durationSeconds: 180,
        perSecond: 0.4,
        unlockTech: "commerce_i",
      },
      {
        cost: { metal: 640, credits: 320 },
        durationSeconds: 600,
        perSecond: 1.5,
        unlockTech: "commerce_ii",
      },
    ],
  },
  lab: {
    type: "lab",
    name: "Research Lab",
    description: "Generates science used for research.",
    tiers: [
      { cost: { metal: 80, food: 20 }, durationSeconds: 60, perSecond: 0.5 },
      {
        cost: { metal: 240, food: 60, credits: 80 },
        durationSeconds: 180,
        perSecond: 1.5,
        unlockTech: "scientific_method",
      },
      {
        cost: { metal: 640, food: 160, credits: 320 },
        durationSeconds: 600,
        perSecond: 4,
        unlockTech: "computing",
      },
    ],
  },
  barracks: {
    type: "barracks",
    name: "Barracks",
    description: "Trains military strength. Will matter when combat lands.",
    tiers: [
      { cost: { metal: 100 }, durationSeconds: 60, perSecond: 0.3 },
      {
        cost: { metal: 300, credits: 100 },
        durationSeconds: 180,
        perSecond: 1,
        unlockTech: "drill",
      },
      {
        cost: { metal: 800, credits: 400 },
        durationSeconds: 600,
        perSecond: 3,
        unlockTech: "logistics",
      },
    ],
  },
};

export function getBuildingDef(type: string): BuildingDef | undefined {
  return BUILDINGS[type as BuildingType];
}

export function buildingTierKey(type: BuildingType, tier: number): string {
  return `${type}_${tier}`;
}

export function parseBuildingKey(
  key: string,
): { type: BuildingType; tier: number } | null {
  const sep = key.lastIndexOf("_");
  if (sep < 0) return null;
  const type = key.slice(0, sep) as BuildingType;
  const tier = Number.parseInt(key.slice(sep + 1), 10);
  if (!BUILDING_TYPES.includes(type) || !Number.isFinite(tier) || tier < 1) {
    return null;
  }
  return { type, tier };
}

// ---- Population mechanics -------------------------------------------------

/**
 * Per GAMEPLAY §4.1. Raw carrying capacity for each biome, before tech
 * and variety modifiers.
 */
export const BIOME_BASE_POPULATION: Record<Biome, number> = {
  molten: 500,
  gas: 0,
  toxic: 1_000,
  ice: 2_000,
  rocky: 3_000,
  desert: 5_000,
  tundra: 8_000,
  jungle: 20_000,
  earthlike: 25_000,
  ocean: 15_000,
};

/**
 * Stacking habitat techs raise the global cap multiplier. We pick the
 * **highest** unlocked tier rather than multiplying — Arcology supersedes
 * Better Habitats, etc.
 */
export const HABITAT_TECH_MULTIPLIERS: ReadonlyArray<{ tech: TechId; mult: number }> = [
  { tech: "better_habitats", mult: 1.5 },
  { tech: "arcologies", mult: 2.5 },
  { tech: "megacities", mult: 5.0 },
];

export function habitatTechMultiplier(techs: ReadonlySet<string>): number {
  let best = 1;
  for (const { tech, mult } of HABITAT_TECH_MULTIPLIERS) {
    if (techs.has(tech)) best = Math.max(best, mult);
  }
  return best;
}

/**
 * Variety bonus: how many distinct building types this colony has.
 * "Need a variety to fill jobs" — see GAMEPLAY §4.1.
 */
const VARIETY_TABLE = [0.5, 0.5, 1.0, 1.3, 1.6, 2.0] as const;

export function distinctBuildingTypes(buildings: Record<string, number>): number {
  const types = new Set<string>();
  for (const [key, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const parsed = parseBuildingKey(key);
    if (parsed) types.add(parsed.type);
  }
  return types.size;
}

export function varietyMultiplier(buildings: Record<string, number>): number {
  const n = distinctBuildingTypes(buildings);
  return VARIETY_TABLE[Math.min(n, VARIETY_TABLE.length - 1)] ?? 2;
}

export function populationCap(
  biome: Biome,
  buildings: Record<string, number>,
  techs: ReadonlySet<string>,
): number {
  const base = BIOME_BASE_POPULATION[biome] ?? 1_000;
  return Math.round(base * habitatTechMultiplier(techs) * varietyMultiplier(buildings));
}

/**
 * Food-gated growth rate. Per GAMEPLAY §4.2:
 *   consumption = pop / 10_000 food/s
 *   effective = baseHab × clamp(produced/consumed, 0, 1.5)
 */
export function effectivePopulationRate(args: {
  population: number;
  habitability: number;
  foodProducedPerSec: number;
}): number {
  const base = populationRateForBiome(args.habitability);
  if (base <= 0) return 0;
  const consumed = Math.max(args.population / 10_000, 0);
  if (consumed <= 0) return base; // tiny populations are food-free
  const ratio = Math.max(0, Math.min(1.5, args.foodProducedPerSec / consumed));
  return base * ratio;
}

// ---- Per-colony rate aggregation ------------------------------------------

export interface ColonyTargetRates {
  metal: number;
  food: number;
  science: number;
  military: number;
  /** This colony's contribution to the global credits rate. */
  creditsContribution: number;
}

/**
 * Sum every building's contribution at the colony, plus the §5.2 home
 * baseline if `isHome` is true.
 *
 * Trade-hub credits output is multiplied by the colony's variety
 * multiplier — diverse colonies earn way more from the same hub.
 */
export function colonyTargetRates(
  buildings: Record<string, number>,
  isHome: boolean,
): ColonyTargetRates {
  const rates: ColonyTargetRates = {
    metal: isHome ? HOME_COLONY_RESOURCE_RATES.metalPerSecond : 0,
    food: isHome ? HOME_COLONY_RESOURCE_RATES.foodPerSecond : 0,
    science: isHome ? HOME_COLONY_RESOURCE_RATES.sciencePerSecond : 0,
    military: isHome ? HOME_COLONY_RESOURCE_RATES.militaryPerSecond : 0,
    creditsContribution: 0,
  };

  const variety = varietyMultiplier(buildings);

  for (const [key, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const parsed = parseBuildingKey(key);
    if (!parsed) continue;
    const def = BUILDINGS[parsed.type];
    const tier = def.tiers[parsed.tier - 1];
    if (!tier) continue;
    const total = tier.perSecond * count;
    switch (parsed.type) {
      case "mine":
        rates.metal += total;
        break;
      case "farm":
        rates.food += total;
        break;
      case "lab":
        rates.science += total;
        break;
      case "barracks":
        rates.military += total;
        break;
      case "trade_hub":
        rates.creditsContribution += total * variety;
        break;
    }
  }

  return rates;
}

/**
 * Global credits rate = sum across all colonies + the home baseline trickle.
 * The "homeColonyId" is passed only to know whether to add the §5.2
 * baseline 0.1 credits/s.
 */
export function globalCreditsRate(
  perColonyContributions: number[],
  hasHome: boolean,
): number {
  const baseline = hasHome ? HOME_COLONY_RESOURCE_RATES.creditsPerSecond : 0;
  return baseline + perColonyContributions.reduce((s, x) => s + x, 0);
}
