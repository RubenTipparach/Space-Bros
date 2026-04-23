"use client";

import { useEffect, useState } from "react";
import { TECHS, accumulatorAt, type TechDef } from "@space-bros/shared";
import type { MeResponse, PlayerState } from "./usePlayer";

interface Props {
  me: MeResponse;
  startResearch: PlayerState["startResearch"];
}

function clientNow(me: MeResponse): number {
  // Shift the server clock into local time. Avoids drift from device
  // clocks being off by minutes.
  const offset = Date.now() - me.serverTime;
  return me.serverTime + offset;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "done";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export function ResearchPanel({ me, startResearch }: Props) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [tick, setTick] = useState(0);

  // Re-render the countdown every second when a research is in flight.
  useEffect(() => {
    if (!me.pendingResearch) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [me.pendingResearch]);

  const owned = new Set(me.research);
  const busy = me.pendingResearch;
  const available: TechDef[] = Object.values(TECHS).filter((t) => {
    if (owned.has(t.id)) return false;
    if (busy && busy.techId === t.id) return false;
    return t.prereqs.every((p) => owned.has(p));
  });

  // Per ADR-012, science is a per-colony stockpile. SP-1a defaults to
  // researching at home; SP-1b will let the player pick which colony
  // contributes science.
  const home = me.homeColony;
  const credits = me.credits;
  const canAfford = (tech: TechDef): boolean => {
    if (!home || !credits) return false;
    const now = clientNow(me);
    const science = accumulatorAt(home.science, now);
    const metal = accumulatorAt(home.metal, now);
    const food = accumulatorAt(home.food, now);
    const military = accumulatorAt(home.military, now);
    const credBal = accumulatorAt(credits, now);
    return (
      science >= (tech.cost.science ?? 0) &&
      metal >= (tech.cost.metal ?? 0) &&
      food >= (tech.cost.food ?? 0) &&
      military >= (tech.cost.military ?? 0) &&
      credBal >= (tech.cost.credits ?? 0)
    );
  };

  const chosen = available.find((t) => t.id === selected) ?? available[0];

  const handleStart = async () => {
    if (!chosen) return;
    setPending(true);
    setErr(null);
    const res = await startResearch(chosen.id, home?.id);
    setPending(false);
    if (!res.ok) setErr(res.error.message ?? res.error.error);
  };

  if (!me.player.homeColonyId) {
    // No home yet → research is locked.
    return null;
  }

  return (
    <section className="research-panel">
      <h3>Research {tick > 0 ? "" : ""}</h3>
      {busy ? (
        <p className="muted">
          Researching <strong>{TECHS[busy.techId]?.name ?? busy.techId}</strong> —{" "}
          {formatDuration(busy.fireAt - clientNow(me))}
        </p>
      ) : available.length === 0 ? (
        <p className="muted">All starter techs researched.</p>
      ) : (
        <>
          <label>
            <span className="muted">Start:</span>
            <select
              value={chosen?.id ?? ""}
              onChange={(e) => setSelected(e.target.value)}
              disabled={pending}
            >
              {available.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {chosen ? (
            <p className="muted tiny">
              {chosen.description} · cost{" "}
              {chosen.cost.science ? `${chosen.cost.science}S ` : ""}
              {chosen.cost.metal ? `${chosen.cost.metal}M ` : ""}
              {chosen.cost.food ? `${chosen.cost.food}F ` : ""}
              {chosen.cost.military ? `${chosen.cost.military}X ` : ""}
              {chosen.cost.credits ? `$${chosen.cost.credits} ` : ""}·{" "}
              {formatDuration(chosen.durationSeconds * 1000)}
            </p>
          ) : null}
          <button
            className="primary"
            disabled={pending || !chosen || !canAfford(chosen)}
            onClick={handleStart}
          >
            {pending ? "starting…" : "Start research"}
          </button>
        </>
      )}
      {err ? <p className="error">{err}</p> : null}
    </section>
  );
}
