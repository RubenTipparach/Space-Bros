import {
  COLONY_SHIP_COST,
  HABITABLE_MIN_HABITABILITY,
  HOME_COLONY_RESOURCE_RATES,
  PER_COLONY_RESOURCES,
  TECHS,
  accumulatorAt,
  colonistsForShip,
  distanceLy,
  generateGalaxy,
  populationRateForBiome,
  travelEstimate,
  type Biome,
  type Galaxy,
  type PerColonyResource,
  type ResourceCost,
} from "@space-bros/shared";
import type {
  ApiResult,
  LaunchArgs,
  MeResponse,
  ServerApi,
} from "./types";

/**
 * Browser-only implementation. Mirrors the server routes after ADR-012
 * (per-colony stockpiles + global credits):
 *   - pickHome: hab >= 0.2, only once, seeds home rates + global credits
 *   - startResearch: deducts science from a chosen colony (default: home)
 *   - launchColony: deducts source-colony metal + global credits
 *
 * Each call drains overdue events first via a switch-per-kind that mirrors
 * lib/db/tick.ts applyEvent. State is versioned — older saves get
 * discarded with a console warning.
 */

const STORAGE_KEY = "sb_offline_v2";
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

interface OfflineAccumulator {
  value: number;
  rate: number;
  t0: number;
}

interface OfflineColony {
  id: string;
  planetId: string;
  biome: string;
  foundedAt: number;
  populationValue: number;
  populationRate: number;
  populationT0: number;
  populationCap: number | null;
  buildings: Record<string, number>;
  metal: OfflineAccumulator;
  food: OfflineAccumulator;
  science: OfflineAccumulator;
  military: OfflineAccumulator;
}

interface OfflineFleet {
  id: string;
  fromStarId: number;
  toStarId: number;
  departAt: number;
  arriveAt: number;
  ships: Record<string, number>;
}

interface OfflineState {
  version: 2;
  player: {
    id: string;
    displayName: string;
    homeColonyId: string | null;
    lastSimAt: number;
  };
  credits: OfflineAccumulator;
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

function zeroAccumulator(now: number): OfflineAccumulator {
  return { value: 0, rate: 0, t0: now };
}

function initialState(): OfflineState {
  const now = Date.now();
  return {
    version: 2,
    player: {
      id: newId("offline"),
      displayName: "Offline Commander",
      homeColonyId: null,
      lastSimAt: now,
    },
    credits: zeroAccumulator(now),
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
    if (parsed.version !== 2) throw new Error("version mismatch");
    return parsed as OfflineState;
  } catch (err) {
    console.warn("offline: discarding incompatible save", err);
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
  for (const event of due) s = applyOfflineEvent(s, event);
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
        populationCap: null,
        buildings: {},
        metal: zeroAccumulator(event.fireAt),
        food: zeroAccumulator(event.fireAt),
        science: zeroAccumulator(event.fireAt),
        military: zeroAccumulator(event.fireAt),
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
      // Consumed but no-op. SP-1b wires up building_complete; Chunk 10
      // wires up combat; SP-3 wires up terraform_complete.
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

// ---- Resource accounting (mirrors lib/db/orders.ts deductCost) -----------

interface ColonySnapshot {
  metal: number;
  food: number;
  science: number;
  military: number;
  now: number;
}

function snapshotColony(colony: OfflineColony, now: number): ColonySnapshot {
  return {
    metal: accumulatorAt(colony.metal, now),
    food: accumulatorAt(colony.food, now),
    science: accumulatorAt(colony.science, now),
    military: accumulatorAt(colony.military, now),
    now,
  };
}

function err(code: string, message: string) {
  return { ok: false as const, error: { error: code, message } };
}

/**
 * Apply a `ResourceCost` to a colony + global credits, in place.
 * Returns the patched objects; caller must save the new state.
 */
function applyDeduction(
  state: OfflineState,
  colonyId: string | null,
  cost: ResourceCost,
  now: number,
): { state: OfflineState } | { err: { ok: false; error: { error: string; message: string } } } {
  let creditsAcc = state.credits;
  if ((cost.credits ?? 0) > 0) {
    const balance = accumulatorAt(creditsAcc, now);
    if (balance < (cost.credits ?? 0)) {
      return { err: err("insufficient_credits", `Need ${cost.credits} credits.`) };
    }
    creditsAcc = { ...creditsAcc, value: balance - (cost.credits ?? 0), t0: now };
  }

  let colonies = state.colonies;
  const hasPerColony = PER_COLONY_RESOURCES.some((k) => (cost[k] ?? 0) > 0);
  if (hasPerColony) {
    if (!colonyId) return { err: err("colony_required", "This cost needs a source colony.") };
    const colony = state.colonies[colonyId];
    if (!colony) return { err: err("colony_not_found", "Colony missing.") };
    const snap = snapshotColony(colony, now);
    const shortfalls: string[] = [];
    for (const r of PER_COLONY_RESOURCES) {
      const need = cost[r] ?? 0;
      if (need > 0 && snap[r] < need) {
        shortfalls.push(`${need} ${r}`);
      }
    }
    if (shortfalls.length > 0) {
      return { err: err("insufficient_resources", `Colony short on: ${shortfalls.join(", ")}.`) };
    }
    const next: OfflineColony = { ...colony };
    for (const r of PER_COLONY_RESOURCES) {
      const need = cost[r] ?? 0;
      if (need <= 0) continue;
      next[r] = { ...colony[r], value: snap[r] - need, t0: now };
    }
    colonies = { ...state.colonies, [colonyId]: next };
  }

  return { state: { ...state, credits: creditsAcc, colonies } };
}

function findPending(state: OfflineState, kind: OfflineEvent["kind"]): OfflineEvent | null {
  return state.events.find((e) => e.kind === kind) ?? null;
}

// ---- ServerApi implementation ---------------------------------------------

function colonyView(c: OfflineColony) {
  return {
    id: c.id,
    planetId: c.planetId,
    biome: c.biome,
    foundedAt: c.foundedAt,
    populationValue: c.populationValue,
    populationRate: c.populationRate,
    populationT0: c.populationT0,
    populationCap: c.populationCap,
    buildings: c.buildings,
    metal: c.metal,
    food: c.food,
    science: c.science,
    military: c.military,
  };
}

export class OfflineApi implements ServerApi {
  readonly mode = "offline" as const;

  async getMe(): Promise<ApiResult<MeResponse>> {
    const now = Date.now();
    const state = drain(loadState(), now);
    saveState(state);

    const homeColony = state.player.homeColonyId
      ? state.colonies[state.player.homeColonyId] ?? null
      : null;

    const pending = findPending(state, "research_complete");
    const pendingResearchPayload = pending
      ? {
          techId: (pending.payload as { techId: string }).techId,
          eventId: pending.id,
          fireAt: pending.fireAt,
          colonyId: ((pending.payload as { colonyId?: string }).colonyId) ?? null,
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
        homeColony: homeColony ? colonyView(homeColony) : null,
        credits: state.credits,
        research: state.research,
        pendingResearch: pendingResearchPayload,
        colonies: Object.values(state.colonies).map(colonyView),
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
    const r = HOME_COLONY_RESOURCE_RATES;

    state = {
      ...state,
      player: { ...state.player, homeColonyId: colonyId },
      credits: { ...state.credits, value: accumulatorAt(state.credits, now), rate: r.creditsPerSecond, t0: now },
      colonies: {
        ...state.colonies,
        [colonyId]: {
          id: colonyId,
          planetId,
          biome: planet.biome,
          foundedAt: now,
          populationValue: 1_000,
          populationRate: populationRateForBiome(planet.habitability),
          populationT0: now,
          populationCap: null,
          buildings: {},
          metal: { value: 0, rate: r.metalPerSecond, t0: now },
          food: { value: 0, rate: r.foodPerSecond, t0: now },
          science: { value: 0, rate: r.sciencePerSecond, t0: now },
          military: { value: 0, rate: r.militaryPerSecond, t0: now },
        },
      },
    };
    saveState(state);
    return { ok: true };
  }

  async startResearch(techId: string, requestedColonyId?: string): Promise<ApiResult> {
    const tech = TECHS[techId];
    if (!tech) return err("unknown_tech", `Unknown tech: ${techId}`);

    const now = Date.now();
    let state = drain(loadState(), now);

    const colonyId =
      requestedColonyId ?? state.player.homeColonyId ?? null;
    if (!colonyId || !state.colonies[colonyId]) {
      return err("no_home_colony", "Pick a home planet before researching.");
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

    const deducted = applyDeduction(state, colonyId, tech.cost, now);
    if ("err" in deducted) return deducted.err;
    state = deducted.state;

    const fireAt = now + tech.durationSeconds * 1000;
    state = {
      ...state,
      events: [
        ...state.events,
        {
          id: newId("evt"),
          kind: "research_complete",
          ownerId: state.player.id,
          fireAt,
          payload: { techId, colonyId },
        },
      ],
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

    const galaxy = getGalaxy();
    const fromStar = galaxy.stars[fromStarId];
    const toStar = galaxy.stars[toStarId];
    if (!fromStar || !toStar) return err("star_not_found", "Star not found.");
    const toPlanet = toStar.planets[toPlanetIndex];
    if (!toPlanet) return err("planet_not_found", "Planet not found.");

    // Find a colony of ours at the source star.
    const sourceColony = Object.values(state.colonies).find((c) =>
      c.planetId.startsWith(`${fromStarId}:`),
    );
    if (!sourceColony) {
      return err("no_source_colony", "You don't have a colony at the source star.");
    }

    const targetPlanetId = `${toStarId}:${toPlanetIndex}`;
    if (Object.values(state.colonies).some((c) => c.planetId === targetPlanetId)) {
      return err("colony_exists", "You already have a colony there.");
    }

    const deducted = applyDeduction(state, sourceColony.id, COLONY_SHIP_COST, now);
    if ("err" in deducted) return deducted.err;
    state = deducted.state;

    const techs = new Set(state.research);
    const distance = distanceLy(fromStar, toStar);
    const estimate = travelEstimate(distance, techs);
    const arriveAt = now + estimate.durationMs;

    const fleetId = newId("flt");
    const eventId = newId("evt");

    state = {
      ...state,
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

/** Reset the offline save. Useful for wiring a "new game" button later. */
export function resetOfflineState(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  // also clear the v1 key from the previous schema if present
  window.localStorage.removeItem("sb_offline_v1");
}

// Reference unused imports defensively so tree-shaking doesn't surprise us.
void PER_COLONY_RESOURCES;
type _Unused = PerColonyResource;
