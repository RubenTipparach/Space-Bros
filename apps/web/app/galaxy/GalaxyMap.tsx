"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Galaxy, Sector } from "@space-bros/shared";
import {
  SPECTRAL_CANVAS_RADIUS,
  SPECTRAL_RGB,
  galaxyBounds,
  generateDust,
  project,
  sectorCenter,
  sectorColor,
  viewBox,
  wedgePath,
} from "./map-helpers";

interface Props {
  galaxy: Galaxy;
  onSelectSector: (sector: Sector) => void;
}

const CANVAS_SIZE = 1200;

export function GalaxyMap({ galaxy, onSelectSector }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bounds = useMemo(() => galaxyBounds(galaxy, 1.02), [galaxy]);
  const dust = useMemo(() => generateDust(galaxy, 30_000), [galaxy]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Dust first (additive-ish via low alpha).
    for (const d of dust) {
      const { px, py } = project(d.x, d.z, bounds, CANVAS_SIZE, CANVAS_SIZE);
      if (px < -4 || py < -4 || px > CANVAS_SIZE + 4 || py > CANVAS_SIZE + 4) continue;
      ctx.fillStyle = `${d.color}${d.alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }

    // Stars.
    for (const star of galaxy.stars) {
      const { px, py } = project(star.x, star.z, bounds, CANVAS_SIZE, CANVAS_SIZE);
      if (px < -4 || py < -4 || px > CANVAS_SIZE + 4 || py > CANVAS_SIZE + 4) continue;
      const [r, g, b] = SPECTRAL_RGB[star.spectralClass];
      const rad = Math.max(1.0, SPECTRAL_CANVAS_RADIUS[star.spectralClass]);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.95)`;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [galaxy, bounds, dust]);

  return (
    <div className="map">
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        className="map-canvas"
      />
      <svg
        className="map-svg"
        viewBox={viewBox(bounds)}
        preserveAspectRatio="xMidYMid meet"
      >
        {galaxy.sectors.map((sector) => {
          const color = sectorColor(sector, galaxy.sectors);
          const center = sectorCenter(sector, galaxy);
          return (
            <g
              key={sector.id}
              className="sector-wedge"
              onClick={() => onSelectSector(sector)}
              role="button"
              tabIndex={0}
            >
              <path
                d={wedgePath(sector, galaxy)}
                fill={color}
                fillOpacity={0.08}
                stroke={color}
                strokeOpacity={0.55}
                strokeWidth={galaxy.radius * 0.004}
              />
              <text
                x={center.x}
                y={center.z}
                textAnchor="middle"
                dominantBaseline="middle"
                className="sector-label"
                style={{ fontSize: galaxy.radius * 0.05 }}
                fill="#ffffff"
              >
                {sector.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
