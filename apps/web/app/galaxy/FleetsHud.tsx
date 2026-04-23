"use client";

import { useEffect, useState } from "react";
import type { FleetSummary, MeResponse } from "./usePlayer";

function formatDuration(ms: number): string {
  if (ms <= 0) return "arriving…";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function FleetsHud({ me }: { me: MeResponse }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (me.fleets.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [me.fleets.length]);

  if (me.fleets.length === 0) return null;

  return (
    <section className="fleets-panel">
      <h3>Fleets in flight</h3>
      <ul>
        {me.fleets.map((f: FleetSummary) => {
          const remaining = f.arriveAt - now;
          const progress = Math.max(
            0,
            Math.min(1, (now - f.departAt) / Math.max(1, f.arriveAt - f.departAt)),
          );
          const shipNames = Object.entries(f.ships)
            .map(([k, v]) => `${v}× ${k.replace("_", " ")}`)
            .join(", ");
          return (
            <li key={f.id}>
              <div className="fleet-row">
                <span>
                  #{f.fromStarId} → #{f.toStarId}
                </span>
                <span className="muted">{formatDuration(remaining)}</span>
              </div>
              <div className="fleet-bar">
                <div className="fleet-bar-fill" style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="muted tiny">{shipNames}</div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
