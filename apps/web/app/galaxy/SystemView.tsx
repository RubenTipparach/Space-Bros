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
}

export function SystemView({ star, onClose, canPickHome, pickHome }: Props) {
  const starColor = rgbToCss(SPECTRAL_COLORS[star.spectralClass]);
  const maxOrbit = star.planets.reduce((m, p) => Math.max(m, p.orbitAu), 1);
  const svgSize = 320;
  const cx = svgSize / 2;
  const cy = svgSize / 2;
  const orbitScale = (svgSize / 2 - 20) / maxOrbit;

  const [pending, setPending] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const handlePick = async (planet: Planet) => {
    setPending(planet.id);
    setPickError(null);
    const res = await pickHome(star.id, planet.index);
    setPending(null);
    if (!res.ok) {
      setPickError(res.error.message ?? res.error.error);
    }
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
          const habPct = Math.round(p.habitability * 100);
          const canPick = canPickHome && p.habitability >= 0.2;
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
              {canPick ? (
                <button
                  className="pick-home"
                  disabled={pending !== null}
                  onClick={() => handlePick(p)}
                >
                  {pending === p.id ? "setting…" : "Set as home"}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {pickError ? <p className="error">{pickError}</p> : null}
      {!canPickHome ? (
        <p className="muted hint">
          Colony / outpost actions land in Chunk 6 once the order API is wired up.
        </p>
      ) : (
        <p className="muted hint">
          Pick a habitable planet (≥ 20%) as your home. You get one shot.
        </p>
      )}
    </aside>
  );
}
