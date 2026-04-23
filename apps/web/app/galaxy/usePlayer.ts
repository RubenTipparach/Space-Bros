"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PlayerSummary {
  id: string;
  displayName: string;
  homeColonyId: string | null;
  lastSimAt: number;
  isDevUser: boolean;
}

export interface HomeColony {
  id: string;
  planetId: string;
  biome: string;
  populationValue: number;
  populationRate: number;
  populationT0: number;
}

export interface MeResponse {
  player: PlayerSummary;
  homeColony: HomeColony | null;
}

export interface ApiError {
  error: string;
  message?: string;
}

export interface PlayerState {
  data: MeResponse | null;
  error: ApiError | null;
  loading: boolean;
  refresh: () => Promise<void>;
  pickHome: (
    starId: number,
    planetIndex: number,
  ) => Promise<{ ok: true } | { ok: false; error: ApiError }>;
}

const DEFAULT_POLL_MS = 15_000;

export function usePlayer(pollMs: number = DEFAULT_POLL_MS): PlayerState {
  const [data, setData] = useState<MeResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/me", { cache: "no-store", credentials: "include" });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as Partial<ApiError>;
        if (mounted.current) {
          setError({ error: body.error ?? `http_${r.status}`, message: body.message });
          setData(null);
        }
        return;
      }
      const json = (await r.json()) as MeResponse;
      if (mounted.current) {
        setData(json);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) {
        setError({
          error: "network",
          message: e instanceof Error ? e.message : "Network error",
        });
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const pickHome = useCallback<PlayerState["pickHome"]>(async (starId, planetIndex) => {
    const r = await fetch("/api/home", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ starId, planetIndex }),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as Partial<ApiError>;
      return {
        ok: false,
        error: { error: body.error ?? `http_${r.status}`, message: body.message },
      };
    }
    await refresh();
    return { ok: true };
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const id = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, pollMs);
    const onVis = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      mounted.current = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh, pollMs]);

  return { data, error, loading, refresh, pickHome };
}
