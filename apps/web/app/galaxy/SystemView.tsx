"use client";

import { useState } from "react";
import type { Planet, Star } from "@space-bros/shared";
import { BIOME_COLORS, SPECTRAL_COLORS } from "./palette";
import type { PlayerState } from "./usePlayer";

function rgbToCss(rgb: readonly [number, number, number]): string {
  const r = Math.round(rgb[0] * 255);
  const g = Math.round(rgb[1] * 255);
  const b = Math.round(rgb[2] * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

interface Props {
  star: Star;
  onClose: () => void;
  canPickHome: boolean;
  pickHome: PlayerState["pickHome"];
  launchColony: PlayerState["launchColony"];
  hasHome: boolean;
  homeStarId: number | null;
  ownedPlanetIds: Set<string>;
  inFlightPlanetIds: Set<string>;
}

export function SystemView({
  star,
  onClose,
  canPickHome,
  pickHome,
  launchColony,
  hasHome,
  homeStarId,
  ownedPlanetIds,
  inFlightPlanetIds,
}: Props) {
  const starColor = rgbToCss(SPECTRAL_COLORS[star.spectralClass]);
  const maxOrbit = star.planets.reduce((m, p) => Math.max(m, p.orbitAu), 1);
  const svgSize = 320;
  const cx = svgSize / 2;
  const cy = svgSize / 2;
  const orbitScale = (svgSize / 2 - 20) / maxOrbit;

  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canLaunch = hasHome && homeStarId !== null && homeStarId !== star.id;

  const handlePick = async (planet: Planet) => {
    setPending(planet.id);
    setActionError(null);
    const res = await pickHome(star.id, planet.index);
    setPending(null);
    if (!res.ok) setActionError(res.error.message ?? res.error.error);
  };

  const handleLaunch = async (planet: Planet) => {
    if (homeStarId === null) return;
    setPending(planet.id);
    setActionError(null);
    const res = await launchColony({
      fromStarId: homeStarId,
      toStarId: star.id,
      toPlanetIndex: planet.index,
    });
    setPending(null);
    if (!res.ok) setActionError(res.error.message ?? res.error.error);
  };

  return (
    <aside className="system-panel">
      <header>
        <div>
          <h2>Star #{star.id}</h2>
          <p className="muted">
            Spectral class <strong>{star.spectralClass}</strong> · {star.planets.length} planet
            {star.planets.length === 1 ? "" : "s"}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close">×</button>
      </header>
      <svg
        viewBox={`0 0 ${svgSize} ${svgSize}`}
        width="100%"
        style={{ maxWidth: svgSize, display: "block", margin: "0 auto" }}
      >
        {star.planets.map((p) => {
          const r = Math.max(8, p.orbitAu * orbitScale);
          return (
            <circle
              key={p.id}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="#222a3a"
              strokeWidth={1}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={7} fill={starColor} />
        {star.planets.map((p, i) => {
          const r = Math.max(8, p.orbitAu * orbitScale);
          const theta = (i / Math.max(1, star.planets.length)) * Math.PI * 2;
          const px = cx + Math.cos(theta) * r;
          const py = cy + Math.sin(theta) * r;
          const pr = 2 + p.size * 2;
          return <circle key={p.id} cx={px} cy={py} r={pr} fill={BIOME_COLORS[p.biome]} />;
        })}
      </svg>
      <ul className="planet-list">
        {star.planets.length === 0 ? <li className="muted">No planets.</li> : null}
        {star.planets.map((p) => {
          const planetId = `${star.id}:${p.index}`;
          const habPct = Math.round(p.habitability * 100);
          const isOwn = ownedPlanetIds.has(planetId);
          const isInFlight = inFlightPlanetIds.has(planetId);
          const pickable = canPickHome && p.habitability >= 0.2;
          const launchable = canLaunch && !isOwn && !isInFlight && p.habitability >= 0.2;
          return (
            <li key={p.id}>
              <span
                className="biome-dot"
                style={{ background: BIOME_COLORS[p.biome] }}
                aria-hidden
              />
              <span className="planet-name">Planet {p.index + 1}</span>
              <span className="muted">
                {p.biome} · {p.orbitAu.toFixed(1)} AU · hab {habPct}%
              </span>
              {isOwn ? <span className="tag">yours</span> : null}
              {isInFlight ? <span className="tag pending">fleet en route</span> : null}
              {pickable ? (
                <button
                  className="pick-home"
                  disabled={pending !== null}
                  onClick={() => handlePick(p)}
                >
                  {pending === p.id ? "setting…" : "Set as home"}
                </button>
              ) : null}
              {!pickable && launchable ? (
                <button
                  className="pick-home"
                  disabled={pending !== null}
                  onClick={() => handleLaunch(p)}
                >
                  {pending === p.id ? "launching…" : "Launch colony ship"}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {actionError ? <p className="error">{actionError}</p> : null}
      {!hasHome ? (
        <p className="muted hint">
          Pick a habitable planet (≥ 20%) as your home. You get one shot.
        </p>
      ) : !canLaunch ? (
        <p className="muted hint">This is your home system. Pick another system to expand.</p>
      ) : (
        <p className="muted hint">
          Launches cost 200 metal + 100 energy. Travel ~5 min / light-year (faster with research).
        </p>
      )}
    </aside>
  );
}
