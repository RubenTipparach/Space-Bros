"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IS_OFFLINE, getApi } from "@/lib/api";
import type {
  ApiError,
  ApiResult,
  LaunchArgs,
  MeResponse,
} from "@/lib/api/types";

export type {
  PlayerSummary,
  HomeColony,
  AccumulatorView,
  ResourcesView,
  PendingResearch,
  ColonySummary,
  FleetSummary,
  MeResponse,
  ApiError,
} from "@/lib/api/types";

export interface PlayerState {
  data: MeResponse | null;
  error: ApiError | null;
  loading: boolean;
  refresh: () => Promise<void>;
  pickHome: (
    starId: number,
    planetIndex: number,
  ) => Promise<ApiResult>;
  startResearch: (techId: string) => Promise<ApiResult>;
  launchColony: (args: LaunchArgs) => Promise<ApiResult>;
}

// Offline mode: tick the loop fast so fleets and research feel live.
// Online: 15s is gentle on Neon + Vercel, 60s when the tab is hidden.
const POLL_ACTIVE_MS = IS_OFFLINE ? 1_000 : 15_000;
const POLL_HIDDEN_MS = IS_OFFLINE ? 5_000 : 60_000;

export function usePlayer(): PlayerState {
  const [data, setData] = useState<MeResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  const api = getApi();

  const refresh = useCallback(async () => {
    const res = await api.getMe();
    if (!mounted.current) return;
    if (res.ok) {
      setData(res.data);
      setError(null);
    } else {
      setError(res.error);
      setData(null);
    }
    setLoading(false);
  }, [api]);

  const pickHome = useCallback<PlayerState["pickHome"]>(async (starId, planetIndex) => {
    const res = await api.pickHome(starId, planetIndex);
    if (res.ok) await refresh();
    return res;
  }, [api, refresh]);

  const startResearch = useCallback<PlayerState["startResearch"]>(async (techId) => {
    const res = await api.startResearch(techId);
    if (res.ok) await refresh();
    return res;
  }, [api, refresh]);

  const launchColony = useCallback<PlayerState["launchColony"]>(async (args) => {
    const res = await api.launchColony(args);
    if (res.ok) await refresh();
    return res;
  }, [api, refresh]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    let id = window.setInterval(refresh, POLL_ACTIVE_MS);
    const onVis = () => {
      window.clearInterval(id);
      if (!document.hidden) refresh();
      id = window.setInterval(refresh, document.hidden ? POLL_HIDDEN_MS : POLL_ACTIVE_MS);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      mounted.current = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  return { data, error, loading, refresh, pickHome, startResearch, launchColony };
}
