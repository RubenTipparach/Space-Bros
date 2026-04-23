/**
 * Shared types for the API adapter layer. Defined once so the HTTP
 * and offline implementations can't drift.
 *
 * Resource model (ADR-012):
 *   - `credits` is global to the empire.
 *   - metal / food / science / military are per-colony — each `ColonySummary`
 *     carries its own four accumulators.
 */

export interface PlayerSummary {
  id: string;
  displayName: string;
  homeColonyId: string | null;
  lastSimAt: number;
  isDevUser: boolean;
  isOffline?: boolean;
}

export interface AccumulatorView {
  value: number;
  rate: number;
  t0: number;
}

export interface ColonyResources {
  metal: AccumulatorView;
  food: AccumulatorView;
  science: AccumulatorView;
  military: AccumulatorView;
}

export interface HomeColony extends ColonyResources {
  id: string;
  planetId: string;
  biome: string;
  populationValue: number;
  populationRate: number;
  populationT0: number;
}

export interface ColonySummary extends ColonyResources {
  id: string;
  planetId: string;
  biome: string;
  populationValue: number;
  populationRate: number;
  populationT0: number;
  populationCap: number | null;
  buildings: Record<string, number>;
}

export interface PendingResearch {
  techId: string;
  eventId: string;
  fireAt: number;
  colonyId: string | null;
}

export interface FleetSummary {
  id: string;
  fromStarId: number;
  toStarId: number;
  departAt: number;
  arriveAt: number;
  ships: Record<string, number>;
}

export interface MeResponse {
  player: PlayerSummary;
  homeColony: HomeColony | null;
  /** Empire-wide credits accumulator. */
  credits: AccumulatorView | null;
  research: string[];
  pendingResearch: PendingResearch | null;
  colonies: ColonySummary[];
  fleets: FleetSummary[];
  serverTime: number;
}

export interface ApiError {
  error: string;
  message?: string;
}

export type ApiResult<T = void> = [T] extends [void]
  ? { ok: true } | { ok: false; error: ApiError }
  : { ok: true; data: T } | { ok: false; error: ApiError };

export interface LaunchArgs {
  fromStarId: number;
  toStarId: number;
  toPlanetIndex: number;
}

export interface ServerApi {
  readonly mode: "http" | "offline";
  getMe(): Promise<ApiResult<MeResponse>>;
  pickHome(starId: number, planetIndex: number): Promise<ApiResult>;
  /** colonyId is optional — server defaults to the player's home colony. */
  startResearch(techId: string, colonyId?: string): Promise<ApiResult>;
  launchColony(args: LaunchArgs): Promise<ApiResult>;
}
