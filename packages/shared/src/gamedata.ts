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
