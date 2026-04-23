import type { Accumulator, Millis, SimEvent } from "./sim.ts";
import type { Biome } from "./galaxy.ts";

export type PlayerId = string;
export type PlanetId = string;
export type ColonyId = string;
export type FleetId = string;
export type TechId = string;
export type BuildingId = string;
export type ShipId = string;

export interface Resources {
  metal: Accumulator;
  energy: Accumulator;
  science: Accumulator;
}

export interface Colony {
  id: ColonyId;
  planetId: PlanetId;
  ownerId: PlayerId;
  foundedAt: Millis;
  population: Accumulator;
  biome: Biome;
  buildings: Record<BuildingId, number>;
}

export interface Fleet {
  id: FleetId;
  ownerId: PlayerId;
  ships: Record<ShipId, number>;
  fromStarId: number;
  toStarId: number;
  departAt: Millis;
  arriveAt: Millis;
}

export interface PlayerState {
  playerId: PlayerId;
  now: Millis;
  homeColonyId: ColonyId | null;
  resources: Resources;
  research: Set<TechId>;
  colonies: Record<ColonyId, Colony>;
  fleets: Record<FleetId, Fleet>;
  pendingEvents: SimEvent[];
}

export function emptyResources(now: Millis): Resources {
  const zero = (): Accumulator => ({ value: 0, rate: 0, t0: now });
  return { metal: zero(), energy: zero(), science: zero() };
}

export function createPlayerState(playerId: PlayerId, now: Millis): PlayerState {
  return {
    playerId,
    now,
    homeColonyId: null,
    resources: emptyResources(now),
    research: new Set(),
    colonies: {},
    fleets: {},
    pendingEvents: [],
  };
}
