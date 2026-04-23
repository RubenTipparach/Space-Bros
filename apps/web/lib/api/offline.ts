import {
  COLONY_SHIP_COST,
  HABITABLE_MIN_HABITABILITY,
  HOME_COLONY_RESOURCE_RATES,
  TECHS,
  accumulatorAt,
  colonistsForShip,
  distanceLy,
  generateGalaxy,
  populationRateForBiome,
  travelEstimate,
  type Biome,
  type Galaxy,
  type ResourceCost,
} from "@space-bros/shared";
import type {
  ApiResult,
  LaunchArgs,
  MeResponse,
  ServerApi,
} from "./types";

/**
 * Browser-only implementation. Mirrors the server routes:
 *   - Same validation rules (hab >= 0.2, no double-colonize, etc.)
 *   - Same event-queue model (events have fire_at, drained on each read)
 *   - Same pure formulas (accumulator math, travel time, colonist count)
 *
 * State lives in a single localStorage key. The key is versioned so
 * we can break shape freely — old saves get discarded with a console
 * warning rather than crashing the app.
 */

const STORAGE_KEY = "sb_offline_v1";
const GALAXY_SEED =
  (process.env.NEXT_PUBLIC_GALAXY_SEED as string | undefined) ?? "space-bros-offline";
const GALAXY_STAR_COUNT = Number.parseInt(
  (process.env.NEXT_PUBLIC_GALAXY_STAR_COUNT as string | undefined) ?? "12000",
  10,
);

interface OfflineEvent {
  id: string;
  kind:
    | "research_complete"
    | "building_complete"
    | "terraform_complete"
    | "fleet_arrive"
    | "colony_founded"
    | "combat";
  ownerId: string;
  fireAt: number;
  payload: unknown;
}

interface OfflineColony {
  id: string;
  planetId: string;
  biome: string;
  foundedAt: number;
  populationValue: number;
  populationRate: number;
  populationT0: number;
}

interface OfflineFleet {
  id: string;
  fromStarId: number;
  toStarId: number;
  departAt: number;
  arriveAt: number;
  ships: Record<string, number>;
}

interface OfflineResources {
  metalValue: number;
  metalRate: number;
  metalT0: number;
  energyValue: number;
  energyRate: number;
  energyT0: number;
  scienceValue: number;
  scienceRate: number;
  scienceT0: number;
}

interface OfflineState {
  version: 1;
  player: {
    id: string;
    displayName: string;
    homeColonyId: string | null;
    lastSimAt: number;
  };
  resources: OfflineResources | null;
  research: string[];
  colonies: Record<string, OfflineColony>;
  fleets: Record<string, OfflineFleet>;
  events: OfflineEvent[];
  ordersLog: Record<string, number>;
}

function newId(prefix: string): string {
  const rnd = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}_${rnd}`;
}

function initialState(): OfflineState {
  return {
    version: 1,
    player: {
      id: newId("offline"),
      displayName: "Offline Commander",
      homeColonyId: null,
      lastSimAt: Date.now(),
    },
    resources: null,
    research: [],
    colonies: {},
    fleets: {},
    events: [],
    ordersLog: {},
  };
}

function loadState(): OfflineState {
  if (typeof window === "undefined") return initialState();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return initialState();
  try {
    const parsed = JSON.parse(raw) as Partial<OfflineState>;
    if (parsed.version !== 1) throw new Error("version mismatch");
    return parsed as OfflineState;
  } catch (err) {
    console.warn("offline: discarding corrupt save", err);
    return initialState();
  }
}

function saveState(state: OfflineState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("offline: failed to save state", err);
  }
}

let galaxyCache: Galaxy | null = null;
function getGalaxy(): Galaxy {
  if (galaxyCache) return galaxyCache;
  galaxyCache = generateGalaxy({ seed: GALAXY_SEED, starCount: GALAXY_STAR_COUNT });
  return galaxyCache;
}

// ---- Event drain (mirror of lib/db/tick.ts applyEvent) --------------------

function drain(state: OfflineState, now: number): OfflineState {
  const due: OfflineEvent[] = [];
  const rest: OfflineEvent[] = [];
  for (const e of state.events) {
    if (e.fireAt <= now) due.push(e);
    else rest.push(e);
  }
  if (due.length === 0) return state;

  due.sort((a, b) => a.fireAt - b.fireAt);
  let s: OfflineState = { ...state, events: rest };

  for (const event of due) {
    s = applyOfflineEvent(s, event);
  }

  return { ...s, player: { ...s.player, lastSimAt: now } };
}

function applyOfflineEvent(state: OfflineState, event: OfflineEvent): OfflineState {
  switch (event.kind) {
    case "research_complete": {
      const { techId } = event.payload as { techId: string };
      if (state.research.includes(techId)) return state;
      return { ...state, research: [...state.research, techId] };
    }
    case "fleet_arrive": {
      const { fleetId } = event.payload as { fleetId: string };
      const { [fleetId]: _gone, ...fleets } = state.fleets;
      return { ...state, fleets };
    }
    case "colony_founded": {
      const p = event.payload as {
        fleetId: string;
        planetId: string;
        biome: Biome;
        colonists: number;
      };
      const colonyId = `${state.player.id}:${p.planetId}`;
      const existing = state.colonies[colonyId];
      const { [p.fleetId]: _gone, ...fleets } = state.fleets;

      if (existing) {
        const elapsed = Math.max(0, event.fireAt - existing.populationT0) / 1000;
        const current = existing.populationValue + existing.populationRate * elapsed;
        return {
          ...state,
          fleets,
          colonies: {
            ...state.colonies,
            [colonyId]: {
              ...existing,
              populationValue: current + p.colonists,
              populationT0: event.fireAt,
            },
          },
        };
      }

      const newColony: OfflineColony = {
        id: colonyId,
        planetId: p.planetId,
        biome: p.biome,
        foundedAt: event.fireAt,
        populationValue: p.colonists,
        populationRate: populationRateForBiome(planetHabitability(p.planetId)),
        populationT0: event.fireAt,
      };
      return {
        ...state,
        fleets,
        colonies: { ...state.colonies, [colonyId]: newColony },
        player: {
          ...state.player,
          homeColonyId: state.player.homeColonyId ?? colonyId,
        },
      };
    }
    case "building_complete":
    case "terraform_complete":
    case "combat":
      // Not exercised by 6a/6b orders in offline mode yet. Events of
      // these kinds get consumed but have no effect until later chunks.
      return state;
  }
}

function planetHabitability(planetId: string): number {
  const idx = planetId.indexOf(":");
  if (idx < 0) return 0;
  const starId = Number.parseInt(planetId.slice(0, idx), 10);
  const planetIndex = Number.parseInt(planetId.slice(idx + 1), 10);
  const planet = getGalaxy().stars[starId]?.planets[planetIndex];
  return planet?.habitability ?? 0;
}

// ---- Resource accounting (mirrors lib/db/orders.ts) -----------------------

interface ResourceSnapshot {
  metal: number;
  energy: number;
  science: number;
  now: number;
}

function snapshotResources(res: OfflineResources, now: number): ResourceSnapshot {
  return {
    metal: accumulatorAt({ value: res.metalValue, rate: res.metalRate, t0: res.metalT0 }, now),
    energy: accumulatorAt({ value: res.energyValue, rate: res.energyRate, t0: res.energyT0 }, now),
    science: accumulatorAt(
      { value: res.scienceValue, rate: res.scienceRate, t0: res.scienceT0 },
      now,
    ),
    now,
  };
}

function deduct(
  res: OfflineResources,
  snap: ResourceSnapshot,
  cost: ResourceCost,
): OfflineResources {
  return {
    metalValue: snap.metal - (cost.metal ?? 0),
    metalRate: res.metalRate,
    metalT0: snap.now,
    energyValue: snap.energy - (cost.energy ?? 0),
    energyRate: res.energyRate,
    energyT0: snap.now,
    scienceValue: snap.science - (cost.science ?? 0),
    scienceRate: res.scienceRate,
    scienceT0: snap.now,
  };
}

function canAfford(snap: ResourceSnapshot, cost: ResourceCost): boolean {
  return (
    snap.metal >= (cost.metal ?? 0) &&
    snap.energy >= (cost.energy ?? 0) &&
    snap.science >= (cost.science ?? 0)
  );
}

function err(code: string, message: string) {
  return { ok: false as const, error: { error: code, message } };
}

// ---- ServerApi implementation ---------------------------------------------

export class OfflineApi implements ServerApi {
  readonly mode = "offline" as const;

  async getMe(): Promise<ApiResult<MeResponse>> {
    const now = Date.now();
    const state = drain(loadState(), now);
    saveState(state);

    const homeColony = state.player.homeColonyId
      ? state.colonies[state.player.homeColonyId] ?? null
      : null;

    const resources = state.resources
      ? {
          metal: {
            value: state.resources.metalValue,
            rate: state.resources.metalRate,
            t0: state.resources.metalT0,
          },
          energy: {
            value: state.resources.energyValue,
            rate: state.resources.energyRate,
            t0: state.resources.energyT0,
          },
          science: {
            value: state.resources.scienceValue,
            rate: state.resources.scienceRate,
            t0: state.resources.scienceT0,
          },
        }
      : null;

    const pendingResearch = findPending(state, "research_complete");
    const pendingResearchPayload = pendingResearch
      ? {
          techId: (pendingResearch.payload as { techId: string }).techId,
          eventId: pendingResearch.id,
          fireAt: pendingResearch.fireAt,
        }
      : null;

    return {
      ok: true,
      data: {
        player: {
          id: state.player.id,
          displayName: state.player.displayName,
          homeColonyId: state.player.homeColonyId,
          lastSimAt: state.player.lastSimAt,
          isDevUser: false,
          isOffline: true,
        },
        homeColony: homeColony
          ? {
              id: homeColony.id,
              planetId: homeColony.planetId,
              biome: homeColony.biome,
              populationValue: homeColony.populationValue,
              populationRate: homeColony.populationRate,
              populationT0: homeColony.populationT0,
            }
          : null,
        resources,
        research: state.research,
        pendingResearch: pendingResearchPayload,
        colonies: Object.values(state.colonies).map((c) => ({
          id: c.id,
          planetId: c.planetId,
          biome: c.biome,
          populationValue: c.populationValue,
          populationRate: c.populationRate,
          populationT0: c.populationT0,
        })),
        fleets: Object.values(state.fleets).map((f) => ({
          id: f.id,
          fromStarId: f.fromStarId,
          toStarId: f.toStarId,
          departAt: f.departAt,
          arriveAt: f.arriveAt,
          ships: f.ships,
        })),
        serverTime: now,
      },
    };
  }

  async pickHome(starId: number, planetIndex: number): Promise<ApiResult> {
    const now = Date.now();
    let state = drain(loadState(), now);

    if (state.player.homeColonyId) {
      return err("home_already_set", "This player already has a home colony.");
    }

    const star = getGalaxy().stars[starId];
    if (!star) return err("planet_not_found", "Star not found.");
    const planet = star.planets[planetIndex];
    if (!planet) return err("planet_not_found", "Planet not found.");
    if (planet.habitability < HABITABLE_MIN_HABITABILITY) {
      return err(
        "planet_uninhabitable",
        `Home planets need habitability ≥ ${Math.round(HABITABLE_MIN_HABITABILITY * 100)}%.`,
      );
    }

    const planetId = `${starId}:${planetIndex}`;
    const colonyId = `${state.player.id}:${planetId}`;
    const rate = populationRateForBiome(planet.habitability);

    state = {
      ...state,
      player: { ...state.player, homeColonyId: colonyId },
      colonies: {
        ...state.colonies,
        [colonyId]: {
          id: colonyId,
          planetId,
          biome: planet.biome,
          foundedAt: now,
          populationValue: 1_000,
          populationRate: rate,
          populationT0: now,
        },
      },
      resources: {
        metalValue: 0,
        metalRate: HOME_COLONY_RESOURCE_RATES.metalPerSecond,
        metalT0: now,
        energyValue: 0,
        energyRate: HOME_COLONY_RESOURCE_RATES.energyPerSecond,
        energyT0: now,
        scienceValue: 0,
        scienceRate: HOME_COLONY_RESOURCE_RATES.sciencePerSecond,
        scienceT0: now,
      },
    };
    saveState(state);
    return { ok: true };
  }

  async startResearch(techId: string): Promise<ApiResult> {
    const tech = TECHS[techId];
    if (!tech) return err("unknown_tech", `Unknown tech: ${techId}`);

    const now = Date.now();
    let state = drain(loadState(), now);

    if (!state.resources) {
      return err("no_resources", "Pick a home planet first.");
    }
    if (state.research.includes(techId)) {
      return err("already_researched", "You already have that tech.");
    }
    const missing = tech.prereqs.filter((p) => !state.research.includes(p));
    if (missing.length > 0) {
      return err("missing_prereqs", `Missing prereqs: ${missing.join(", ")}`);
    }
    if (state.events.some((e) => e.kind === "research_complete")) {
      return err("already_researching", "You are already researching something.");
    }

    const snap = snapshotResources(state.resources, now);
    if (!canAfford(snap, tech.cost)) {
      return err("insufficient_resources", "Not enough resources.");
    }

    const fireAt = now + tech.durationSeconds * 1000;
    const event: OfflineEvent = {
      id: newId("evt"),
      kind: "research_complete",
      ownerId: state.player.id,
      fireAt,
      payload: { techId },
    };

    state = {
      ...state,
      resources: deduct(state.resources, snap, tech.cost),
      events: [...state.events, event],
    };
    saveState(state);
    return { ok: true };
  }

  async launchColony({ fromStarId, toStarId, toPlanetIndex }: LaunchArgs): Promise<ApiResult> {
    if (fromStarId === toStarId) {
      return err("same_system", "Pick a target in a different star system.");
    }

    const now = Date.now();
    let state = drain(loadState(), now);
    if (!state.resources) {
      return err("no_resources", "Pick a home planet first.");
    }

    const galaxy = getGalaxy();
    const fromStar = galaxy.stars[fromStarId];
    const toStar = galaxy.stars[toStarId];
    if (!fromStar || !toStar) return err("star_not_found", "Star not found.");
    const toPlanet = toStar.planets[toPlanetIndex];
    if (!toPlanet) return err("planet_not_found", "Planet not found.");

    // Own the source?
    const ownsFrom = Object.values(state.colonies).some((c) =>
      c.planetId.startsWith(`${fromStarId}:`),
    );
    if (!ownsFrom) {
      return err("no_source_colony", "You don't have a colony at the source star.");
    }

    const targetPlanetId = `${toStarId}:${toPlanetIndex}`;
    if (Object.values(state.colonies).some((c) => c.planetId === targetPlanetId)) {
      return err("colony_exists", "You already have a colony there.");
    }

    const snap = snapshotResources(state.resources, now);
    if (!canAfford(snap, COLONY_SHIP_COST)) {
      return err("insufficient_resources", "Need 200 metal + 100 energy.");
    }

    const techs = new Set(state.research);
    const distance = distanceLy(fromStar, toStar);
    const estimate = travelEstimate(distance, techs);
    const arriveAt = now + estimate.durationMs;

    const fleetId = newId("flt");
    const eventId = newId("evt");

    state = {
      ...state,
      resources: deduct(state.resources, snap, COLONY_SHIP_COST),
      fleets: {
        ...state.fleets,
        [fleetId]: {
          id: fleetId,
          fromStarId,
          toStarId,
          departAt: now,
          arriveAt,
          ships: { colony_ship: 1 },
        },
      },
      events: [
        ...state.events,
        {
          id: eventId,
          kind: "colony_founded",
          ownerId: state.player.id,
          fireAt: arriveAt,
          payload: {
            fleetId,
            planetId: targetPlanetId,
            biome: toPlanet.biome,
            colonists: colonistsForShip(techs),
          },
        },
      ],
    };
    saveState(state);
    return { ok: true };
  }
}

function findPending(state: OfflineState, kind: OfflineEvent["kind"]): OfflineEvent | null {
  return state.events.find((e) => e.kind === kind) ?? null;
}

/** Reset the offline save. Useful for wiring a "new game" button later. */
export function resetOfflineState(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
