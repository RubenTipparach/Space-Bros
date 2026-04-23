import type { TechId } from "./state.ts";

/**
 * Minimal starter tech tree. Balance is intentionally rough — Chunk 8
 * expands this into a real research tree with prereqs and tiers.
 *
 * Costs are keyed by the same resource names as `PlayerState.resources`.
 * Durations are in **seconds** (real time).
 */

export interface ResourceCost {
  metal?: number;
  energy?: number;
  science?: number;
}

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
  better_reactors_1: {
    id: "better_reactors_1",
    name: "Better Reactors",
    description: "Chunk 6b will wire this into a +50% energy rate.",
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
    cost: { science: 200, energy: 100 },
    durationSeconds: 420,
    prereqs: ["better_reactors_1"],
  },
};

export function getTech(id: string): TechDef | undefined {
  return TECHS[id];
}

export function listTechs(): TechDef[] {
  return Object.values(TECHS);
}

/** Starting resource rates applied when a player founds their home colony. */
export const HOME_COLONY_RESOURCE_RATES = {
  metalPerSecond: 1.0,
  energyPerSecond: 0.5,
  sciencePerSecond: 0.5,
} as const;

// ---- Travel + colonization ------------------------------------------------

/**
 * Galaxy coordinates are light-years. Base travel speed is a constant
 * minutes-per-ly; research modifies it multiplicatively. 5 min/ly at
 * base gives: nearest-neighbor hops in minutes, sector trips in an
 * hour or two, cross-galaxy expansion in days. Tune freely.
 */
export const BASE_MINUTES_PER_LIGHT_YEAR = 5;

/** Colony ship cost paid at launch. */
export const COLONY_SHIP_COST: ResourceCost = { metal: 200, energy: 100 };

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
