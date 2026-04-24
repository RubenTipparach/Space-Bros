"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Cluster, Galaxy, Sector } from "@space-bros/shared";
import {
  SPECTRAL_CANVAS_RADIUS,
  SPECTRAL_RGB,
  generateDust,
  project,
  sectorBounds,
  sectorColor,
  viewBox,
  wedgePath,
} from "./map-helpers";

interface Props {
  galaxy: Galaxy;
  sector: Sector;
  onSelectCluster: (cluster: Cluster) => void;
}

const CANVAS_SIZE = 1200;

export function SectorMap({ galaxy, sector, onSelectCluster }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bounds = useMemo(() => sectorBounds(sector, galaxy, 1.12), [sector, galaxy]);
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
      if (star.sectorId !== sector.id) continue;
      const { px, py } = project(star.x, star.z, bounds, CANVAS_SIZE, CANVAS_SIZE);
      if (px < -6 || py < -6 || px > CANVAS_SIZE + 6 || py > CANVAS_SIZE + 6) continue;
      const [r, g, b] = SPECTRAL_RGB[star.spectralClass];
      const rad = Math.max(1.5, SPECTRAL_CANVAS_RADIUS[star.spectralClass] * 1.4);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.95)`;
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
        {/* Wedge outline faint */}
        <path
          d={wedgePath(sector, galaxy)}
          fill={color}
          fillOpacity={0.04}
          stroke={color}
          strokeOpacity={0.5}
          strokeWidth={galaxy.radius * 0.003}
        />
        {sectorClusters.map((cluster) => {
          const labelOffset = cluster.spread * 3.5;
          return (
            <g
              key={cluster.id}
              className="cluster-bubble"
              onClick={() => onSelectCluster(cluster)}
              role="button"
              tabIndex={0}
            >
              <circle
                cx={cluster.center.x}
                cy={cluster.center.z}
                r={cluster.spread * 3}
                fill={color}
                fillOpacity={0.12}
                stroke={color}
                strokeOpacity={0.75}
                strokeWidth={galaxy.radius * 0.003}
              />
              <circle
                cx={cluster.center.x}
                cy={cluster.center.z}
                r={cluster.spread * 0.6}
                fill={color}
                fillOpacity={0.4}
              />
              <text
                x={cluster.center.x}
                y={cluster.center.z + labelOffset}
                textAnchor="middle"
                dominantBaseline="hanging"
                className="cluster-label"
                style={{ fontSize: galaxy.radius * 0.022 }}
                fill="#ffffff"
              >
                {cluster.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
