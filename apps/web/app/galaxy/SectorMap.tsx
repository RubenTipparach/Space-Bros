"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Cluster, Galaxy, Sector } from "@space-bros/shared";
import {
  SPECTRAL_CANVAS_RADIUS,
  SPECTRAL_RGB,
  type Bounds,
  generateDust,
  project,
  sectorColor,
  viewBox,
  wedgePath,
} from "./map-helpers";
import { renderHomeMarker } from "./GalaxyMap";

interface Props {
  galaxy: Galaxy;
  sector: Sector;
  bounds: Bounds;
  onSelectCluster: (cluster: Cluster) => void;
  homeStarId?: number | null;
}

const CANVAS_SIZE = 1200;

/**
 * Non-sector stars are dimmed + desaturated so the active region
 * reads as the focus. Per-level tuning in map-helpers VISUALS §7a.
 */
const OFF_ALPHA = 0.18;
const OFF_DESAT_TOWARD = 68; // grey target for the desat lerp (0-255)
const OFF_DESAT_AMOUNT = 0.6; // 0 = no desat, 1 = fully grey

export function SectorMap({ galaxy, sector, bounds, onSelectCluster, homeStarId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dust = useMemo(() => generateDust(galaxy, 25_000), [galaxy]);
  const color = sectorColor(sector, galaxy.sectors);
  const sectorClusters = galaxy.clusters.filter((c) => c.sectorId === sector.id);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    for (const d of dust) {
      const { px, py } = project(d.x, d.z, bounds, CANVAS_SIZE, CANVAS_SIZE);
      if (px < -6 || py < -6 || px > CANVAS_SIZE + 6 || py > CANVAS_SIZE + 6) continue;
      ctx.fillStyle = `${d.color}${d.alpha * 0.85})`;
      ctx.beginPath();
      ctx.arc(px, py, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const star of galaxy.stars) {
      const { px, py } = project(star.x, star.z, bounds, CANVAS_SIZE, CANVAS_SIZE);
      if (px < -6 || py < -6 || px > CANVAS_SIZE + 6 || py > CANVAS_SIZE + 6) continue;
      const inSector = star.sectorId === sector.id;
      const [br, bg, bb] = SPECTRAL_RGB[star.spectralClass];
      const r = inSector ? br : lerp(br, OFF_DESAT_TOWARD, OFF_DESAT_AMOUNT);
      const g = inSector ? bg : lerp(bg, OFF_DESAT_TOWARD, OFF_DESAT_AMOUNT);
      const b = inSector ? bb : lerp(bb, OFF_DESAT_TOWARD, OFF_DESAT_AMOUNT);
      const alpha = inSector ? 0.95 : 0.95 * OFF_ALPHA;
      const rad = Math.max(1.5, SPECTRAL_CANVAS_RADIUS[star.spectralClass] * (inSector ? 1.4 : 1.0));
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [galaxy, bounds, dust, sector]);

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
        <path
          d={wedgePath(sector, galaxy)}
          fill={color}
          fillOpacity={0.04}
          stroke={color}
          strokeOpacity={0.5}
          strokeWidth={galaxy.radius * 0.003}
          style={{ pointerEvents: "none" }}
        />
        {sectorClusters.map((cluster) => {
          const labelOffset = cluster.spread * 3.5;
          return (
            <g key={cluster.id} className="cluster-bubble">
              <circle
                cx={cluster.center.x}
                cy={cluster.center.z}
                r={cluster.spread * 3}
                fill={color}
                fillOpacity={0.12}
                stroke={color}
                strokeOpacity={0.75}
                strokeWidth={galaxy.radius * 0.003}
                onClick={() => onSelectCluster(cluster)}
                style={{ cursor: "pointer", pointerEvents: "visiblePainted" }}
              />
              <circle
                cx={cluster.center.x}
                cy={cluster.center.z}
                r={cluster.spread * 0.6}
                fill={color}
                fillOpacity={0.4}
                style={{ pointerEvents: "none" }}
              />
              <text
                x={cluster.center.x}
                y={cluster.center.z + labelOffset}
                textAnchor="middle"
                dominantBaseline="hanging"
                className="cluster-label"
                style={{ fontSize: galaxy.radius * 0.022, pointerEvents: "none" }}
                fill="#ffffff"
              >
                {cluster.name}
              </text>
            </g>
          );
        })}
        {homeStarId !== undefined && homeStarId !== null
          ? renderHomeMarker(galaxy, homeStarId, "sector")
          : null}
      </svg>
    </div>
  );
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}
