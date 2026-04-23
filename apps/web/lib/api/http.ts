import type {
  ApiError,
  ApiResult,
  LaunchArgs,
  MeResponse,
  ServerApi,
} from "./types";

function newOrderId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function parseError(r: Response): Promise<ApiError> {
  const body = (await r.json().catch(() => ({}))) as Partial<ApiError>;
  return {
    error: body.error ?? `http_${r.status}`,
    ...(body.message !== undefined && { message: body.message }),
  };
}

export class HttpApi implements ServerApi {
  readonly mode = "http" as const;

  async getMe(): Promise<ApiResult<MeResponse>> {
    try {
      const r = await fetch("/api/me", { cache: "no-store", credentials: "include" });
      if (!r.ok) return { ok: false, error: await parseError(r) };
      return { ok: true, data: (await r.json()) as MeResponse };
    } catch (e) {
      return {
        ok: false,
        error: { error: "network", message: e instanceof Error ? e.message : "Network error" },
      };
    }
  }

  async pickHome(starId: number, planetIndex: number): Promise<ApiResult> {
    const r = await fetch("/api/home", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ starId, planetIndex }),
    });
    if (!r.ok) return { ok: false, error: await parseError(r) };
    return { ok: true };
  }

  async startResearch(techId: string, colonyId?: string): Promise<ApiResult> {
    const r = await fetch("/api/orders/research", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId: newOrderId(),
        techId,
        ...(colonyId ? { colonyId } : {}),
      }),
    });
    if (!r.ok) return { ok: false, error: await parseError(r) };
    return { ok: true };
  }

  async launchColony({ fromStarId, toStarId, toPlanetIndex }: LaunchArgs): Promise<ApiResult> {
    const r = await fetch("/api/orders/launch", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: newOrderId(), fromStarId, toStarId, toPlanetIndex }),
    });
    if (!r.ok) return { ok: false, error: await parseError(r) };
    return { ok: true };
  }
}
