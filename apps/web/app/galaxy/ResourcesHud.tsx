"use client";

import { useEffect, useState } from "react";
import { accumulatorAt } from "@space-bros/shared";
import type { MeResponse } from "./usePlayer";

interface Props {
  me: MeResponse;
}

/**
 * Top-level HUD: empire-wide credits balance + GDP (= credits/s rate),
 * plus a compact per-resource readout for the home colony so the player
 * can see their stockpiles tick up. SP-1b will replace the home-colony
 * line with a proper colony picker.
 */
export function ResourcesHud({ me }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const credits = me.credits;
  const home = me.homeColony;

  if (!credits) return null;

  const balance = accumulatorAt(credits, now);
  const gdp = credits.rate;

  return (
    <div className="resources">
      <div className="row">
        <span className="big" title={`+${gdp}/s`}>
          <em>$</em> {Math.floor(balance).toLocaleString()}
        </span>
        <span className="muted tiny">GDP {gdp.toFixed(2)}/s</span>
      </div>
      {home ? (
        <div className="row tiny home-stockpile" title="Home colony stockpiles">
          <span><em>M</em> {Math.floor(accumulatorAt(home.metal, now)).toLocaleString()}</span>
          <span><em>F</em> {Math.floor(accumulatorAt(home.food, now)).toLocaleString()}</span>
          <span><em>S</em> {Math.floor(accumulatorAt(home.science, now)).toLocaleString()}</span>
          <span><em>X</em> {Math.floor(accumulatorAt(home.military, now)).toLocaleString()}</span>
        </div>
      ) : null}
    </div>
  );
}
