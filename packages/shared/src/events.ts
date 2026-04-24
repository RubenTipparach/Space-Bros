import type { Biome } from "./galaxy.ts";
import {
  type Millis,
  type SimEvent,
  compareEvents,
  rebase,
  setRate,
} from "./sim.ts";
import {
  type BuildingId,
  type Colony,
  type ColonyId,
  type FleetId,
  type PlanetId,
  type PlayerState,
  type ShipId,
  type TechId,
} from "./state.ts";

// ---- Event payload schemas ------------------------------------------------

export interface FleetArrivePayload {
  fleetId: FleetId;
}

export interface ColonyFoundedPayload {
  fleetId: FleetId;
  planetId: PlanetId;
  biome: Biome;
  colonists: number;
}

export interface ResearchCompletePayload {
  techId: TechId;
}

export interface BuildingCompletePayload {
  colonyId: ColonyId;
  /** Type from BUILDING_TYPES (mine/farm/trade_hub/lab/barracks). */
  buildingType: string;
  /** 1-indexed tier (1, 2, or 3). */
  tier: number;
}

export interface TerraformCompletePayload {
  colonyId: ColonyId;
  targetBiome: Biome;
}

export interface CombatPayload {
  fleetAId: FleetId;
  fleetBId: FleetId;
}

export type TypedEvent =
  | (SimEvent<FleetArrivePayload> & { kind: "fleet_arrive" })
  | (SimEvent<ColonyFoundedPayload> & { kind: "colony_founded" })
  | (SimEvent<ResearchCompletePayload> & { kind: "research_complete" })
  | (SimEvent<BuildingCompletePayload> & { kind: "building_complete" })
  | (SimEvent<TerraformCompletePayload> & { kind: "terraform_complete" })
  | (SimEvent<CombatPayload> & { kind: "combat" });

// ---- Reducer --------------------------------------------------------------

export interface ProcessResult {
  state: PlayerState;
  emitted: SimEvent[];
}

/**
 * Apply one event to a PlayerState, returning the new state and any
 * follow-up events to schedule. Pure: no I/O, no Date.now(), no Math.random.
 *
 * The caller is responsible for:
 *   - calling events in fire_at order
 *   - rebasing `state.now` to the event's fireAt (we do that internally)
 *   - removing the event from pendingEvents before persisting
 */
export function processEvent(state: PlayerState, event: SimEvent): ProcessResult {
  const now = event.fireAt;
  const base: PlayerState = { ...state, now };

  switch (event.kind) {
    case "research_complete":
      return applyResearchComplete(base, event as SimEvent<ResearchCompletePayload>);
    case "building_complete":
      return applyBuildingComplete(base, event as SimEvent<BuildingCompletePayload>);
    case "terraform_complete":
      return applyTerraformComplete(base, event as SimEvent<TerraformCompletePayload>);
    case "fleet_arrive":
      return applyFleetArrive(base, event as SimEvent<FleetArrivePayload>);
    case "colony_founded":
      return applyColonyFounded(base, event as SimEvent<ColonyFoundedPayload>);
    case "combat":
      // Combat resolution lands in Chunk 10 with seeded RNG.
      return { state: base, emitted: [] };
    default:
      return { state: base, emitted: [] };
  }
}

function applyResearchComplete(
  state: PlayerState,
  event: SimEvent<ResearchCompletePayload>,
): ProcessResult {
  const research = new Set(state.research);
  research.add(event.payload.techId);
  return {
    state: { ...state, research },
    emitted: [],
  };
}

function applyBuildingComplete(
  state: PlayerState,
  event: SimEvent<BuildingCompletePayload>,
): ProcessResult {
  const { colonyId, buildingType, tier } = event.payload;
  const colony = state.colonies[colonyId];
  if (!colony) return { state, emitted: [] };
  const key = `${buildingType}_${tier}`;
  const count = (colony.buildings[key] ?? 0) + 1;
  const updated: Colony = {
    ...colony,
    buildings: { ...colony.buildings, [key]: count },
  };
  return {
    state: { ...state, colonies: { ...state.colonies, [colonyId]: updated } },
    emitted: [],
  };
}

function applyTerraformComplete(
  state: PlayerState,
  event: SimEvent<TerraformCompletePayload>,
): ProcessResult {
  const { colonyId, targetBiome } = event.payload;
  const colony = state.colonies[colonyId];
  if (!colony) return { state, emitted: [] };
  const updated: Colony = { ...colony, biome: targetBiome };
  return {
    state: { ...state, colonies: { ...state.colonies, [colonyId]: updated } },
    emitted: [],
  };
}

function applyFleetArrive(
  state: PlayerState,
  event: SimEvent<FleetArrivePayload>,
): ProcessResult {
  const fleet = state.fleets[event.payload.fleetId];
  if (!fleet) return { state, emitted: [] };
  const { [fleet.id]: _removed, ...remainingFleets } = state.fleets;
  return {
    state: { ...state, fleets: remainingFleets },
    emitted: [],
  };
}

function applyColonyFounded(
  state: PlayerState,
  event: SimEvent<ColonyFoundedPayload>,
): ProcessResult {
  const { fleetId, planetId, biome, colonists } = event.payload;
  const colonyId: ColonyId = `${state.playerId}:${planetId}`;
  if (state.colonies[colonyId]) {
    // Reinforcement: bump population, discard fleet.
    const colony = state.colonies[colonyId];
    const rebased = rebase(colony.population, event.fireAt);
    const updated: Colony = {
      ...colony,
      population: { ...rebased, value: rebased.value + colonists },
    };
    return withFleetRemoved(state, fleetId, {
      ...state,
      colonies: { ...state.colonies, [colonyId]: updated },
    });
  }

  const newColony: Colony = {
    id: colonyId,
    planetId,
    ownerId: state.playerId,
    foundedAt: event.fireAt,
    biome,
    buildings: {},
    population: { value: colonists, rate: 0, t0: event.fireAt },
  };
  const next: PlayerState = {
    ...state,
    homeColonyId: state.homeColonyId ?? colonyId,
    colonies: { ...state.colonies, [colonyId]: newColony },
  };
  return withFleetRemoved(next, fleetId, next);
}

function withFleetRemoved(
  _prev: PlayerState,
  fleetId: FleetId,
  next: PlayerState,
): ProcessResult {
  if (!(fleetId in next.fleets)) return { state: next, emitted: [] };
  const { [fleetId]: _removed, ...remaining } = next.fleets;
  return { state: { ...next, fleets: remaining }, emitted: [] };
}

// ---- Drain helpers --------------------------------------------------------

/**
 * Apply every pending event with fireAt <= now, in order. Returns the new
 * state, the events that were consumed, and any new events that were emitted
 * (which the caller should persist to the `events` table).
 */
export function advanceTo(
  state: PlayerState,
  now: Millis,
): { state: PlayerState; consumed: SimEvent[]; emitted: SimEvent[] } {
  const queue = [...state.pendingEvents].sort(compareEvents);
  const consumed: SimEvent[] = [];
  const emitted: SimEvent[] = [];
  let current: PlayerState = state;

  while (queue.length > 0 && queue[0]!.fireAt <= now) {
    const next = queue.shift()!;
    const { state: advanced, emitted: follow } = processEvent(current, next);
    current = advanced;
    consumed.push(next);
    for (const f of follow) {
      emitted.push(f);
      if (f.fireAt <= now) {
        // Newly emitted, already due — slot into the queue so we apply it.
        insertSorted(queue, f);
      }
    }
  }

  return {
    state: { ...current, now, pendingEvents: queue },
    consumed,
    emitted,
  };
}

function insertSorted(queue: SimEvent[], event: SimEvent): void {
  let lo = 0;
  let hi = queue.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (queue[mid]!.fireAt < event.fireAt) lo = mid + 1;
    else hi = mid;
  }
  queue.splice(lo, 0, event);
}

// ---- Convenience: set colony production rate -----------------------------

/**
 * Recompute a colony's resource contribution to the player and roll the
 * accumulators forward. Called by reducers that change what a colony
 * produces (new building, terraform finish, population cap change).
 */
export function setResourceRate(
  state: PlayerState,
  key: keyof PlayerState["resources"],
  now: Millis,
  rate: number,
): PlayerState {
  return {
    ...state,
    now,
    resources: { ...state.resources, [key]: setRate(state.resources[key], now, rate) },
  };
}
