/**
 * Shared types for the API adapter layer. Defined once so the HTTP
 * and offline implementations can't drift.
 */

export interface PlayerSummary {
  id: string;
  displayName: string;
  homeColonyId: string | null;
  lastSimAt: number;
  isDevUser: boolean;
  isOffline?: boolean;
}

export interface HomeColony {
  id: string;
  planetId: string;
  biome: string;
  populationValue: number;
  populationRate: number;
  populationT0: number;
}

export interface AccumulatorView {
  value: number;
  rate: number;
  t0: number;
}

export interface ResourcesView {
  metal: AccumulatorView;
  energy: AccumulatorView;
  science: AccumulatorView;
}

export interface PendingResearch {
  techId: string;
  eventId: string;
  fireAt: number;
}

export interface ColonySummary {
  id: string;
  planetId: string;
  biome: string;
  populationValue: number;
  populationRate: number;
  populationT0: number;
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
  resources: ResourcesView | null;
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
  startResearch(techId: string): Promise<ApiResult>;
  launchColony(args: LaunchArgs): Promise<ApiResult>;
}
