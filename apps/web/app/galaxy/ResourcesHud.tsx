"use client";

import { useEffect, useState } from "react";
import { accumulatorAt } from "@space-bros/shared";
import type { MeResponse } from "./usePlayer";

interface Props {
  me: MeResponse;
}

export function ResourcesHud({ me }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!me.resources) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [me.resources]);

  const r = me.resources;
  if (!r) return null;

  const clientNow = now;
  const metal = accumulatorAt(r.metal, clientNow);
  const energy = accumulatorAt(r.energy, clientNow);
  const science = accumulatorAt(r.science, clientNow);

  return (
    <div className="resources">
      <span title={`+${r.metal.rate}/s`}>
        <em>M</em> {Math.floor(metal).toLocaleString()}
      </span>
      <span title={`+${r.energy.rate}/s`}>
        <em>E</em> {Math.floor(energy).toLocaleString()}
      </span>
      <span title={`+${r.science.rate}/s`}>
        <em>S</em> {Math.floor(science).toLocaleString()}
      </span>
    </div>
  );
}
