"use client";

import type { Star } from "@space-bros/shared";
import { BIOME_COLORS, SPECTRAL_COLORS } from "./palette";

function rgbToCss(rgb: readonly [number, number, number]): string {
  const r = Math.round(rgb[0] * 255);
  const g = Math.round(rgb[1] * 255);
  const b = Math.round(rgb[2] * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

export function SystemView({ star, onClose }: { star: Star; onClose: () => void }) {
  const starColor = rgbToCss(SPECTRAL_COLORS[star.spectralClass]);
  const maxOrbit = star.planets.reduce((m, p) => Math.max(m, p.orbitAu), 1);
  const svgSize = 320;
  const cx = svgSize / 2;
  const cy = svgSize / 2;
  const orbitScale = (svgSize / 2 - 20) / maxOrbit;

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
          return (
            <g key={p.id}>
              <circle cx={px} cy={py} r={pr} fill={BIOME_COLORS[p.biome]} />
            </g>
          );
        })}
      </svg>
      <ul className="planet-list">
        {star.planets.length === 0 ? <li className="muted">No planets.</li> : null}
        {star.planets.map((p) => (
          <li key={p.id}>
            <span
              className="biome-dot"
              style={{ background: BIOME_COLORS[p.biome] }}
              aria-hidden
            />
            <span className="planet-name">Planet {p.index + 1}</span>
            <span className="muted">
              {p.biome} · {p.orbitAu.toFixed(1)} AU · hab {(p.habitability * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
      <p className="muted hint">
        Colony / outpost actions land in Chunk 6 once the order API is wired up.
      </p>
    </aside>
  );
}
