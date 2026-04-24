"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Cluster, Galaxy, Sector, Star } from "@space-bros/shared";
import {
  SPECTRAL_RGB,
  type Bounds,
  generateDust,
  project,
  sectorColor,
  spectralCss,
  viewBox,
} from "./map-helpers";
import { renderHomeMarker } from "./GalaxyMap";

interface Props {
  galaxy: Galaxy;
  sector: Sector;
  cluster: Cluster;
  bounds: Bounds;
  onSelectStar: (star: Star) => void;
  homeStarId?: number | null;
}

const CANVAS_SIZE = 1200;
const OFF_ALPHA = 0.14;
const OFF_DESAT_TOWARD = 52;
const OFF_DESAT_AMOUNT = 0.75;

export function ClusterMap({
  galaxy,
  sector,
  cluster,
  bounds,
  onSelectStar,
  homeStarId,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dust = useMemo(() => generateDust(galaxy, 12_000), [galaxy]);
  const color = sectorColor(sector, galaxy.sectors);
  const [hover, setHover] = useState<Star | null>(null);

  const clusterStars = useMemo(
    () => galaxy.stars.filter((s) => s.clusterId === cluster.id),
    [galaxy, cluster],
  );

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    for (const d of dust) {
      const { px, py } = project(d.x, d.z, bounds, CANVAS_SIZE, CANVAS_SIZE);
      if (px < -10 || py < -10 || px > CANVAS_SIZE + 10 || py > CANVAS_SIZE + 10) continue;
      ctx.fillStyle = `${d.color}${d.alpha * 0.45})`;
      ctx.beginPath();
      ctx.arc(px, py, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Non-cluster stars rendered dim + desaturated.
    for (const star of galaxy.stars) {
      if (star.clusterId === cluster.id) continue;
      const { px, py } = project(star.x, star.z, bounds, CANVAS_SIZE, CANVAS_SIZE);
      if (px < -10 || py < -10 || px > CANVAS_SIZE + 10 || py > CANVAS_SIZE + 10) continue;
      const [br, bg, bb] = SPECTRAL_RGB[star.spectralClass];
      const r = lerp(br, OFF_DESAT_TOWARD, OFF_DESAT_AMOUNT);
      const g = lerp(bg, OFF_DESAT_TOWARD, OFF_DESAT_AMOUNT);
      const b = lerp(bb, OFF_DESAT_TOWARD, OFF_DESAT_AMOUNT);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${OFF_ALPHA})`;
      ctx.beginPath();
      ctx.arc(px, py, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Soft glow tint at cluster center.
    const { px: cx, py: cy } = project(
      cluster.center.x,
      cluster.center.z,
      bounds,
      CANVAS_SIZE,
      CANVAS_SIZE,
    );
    const clusterRadiusPx =
      ((cluster.spread * 5) / (bounds.maxX - bounds.minX)) * CANVAS_SIZE;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, clusterRadiusPx);
    glow.addColorStop(0, `${color}33`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }, [galaxy, bounds, dust, cluster, color]);

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
        <circle
          cx={cluster.center.x}
          cy={cluster.center.z}
          r={cluster.spread * 3}
          fill="none"
          stroke={color}
          strokeOpacity={0.3}
          strokeDasharray={`${galaxy.radius * 0.006} ${galaxy.radius * 0.004}`}
          strokeWidth={galaxy.radius * 0.002}
          style={{ pointerEvents: "none" }}
        />
        {clusterStars.map((star) => {
          const isHover = hover?.id === star.id;
          const sizeScale = bounds.maxX - bounds.minX;
          const baseR = sizeScale * 0.012;
          return (
            <g
              key={star.id}
              className="cluster-star"
              onMouseEnter={() => setHover(star)}
              onMouseLeave={() =>
                setHover((h) => (h?.id === star.id ? null : h))
              }
            >
              <circle
                cx={star.x}
                cy={star.z}
                r={baseR * 2.5}
                fill="transparent"
                onClick={() => onSelectStar(star)}
                style={{ cursor: "pointer", pointerEvents: "fill" }}
              />
              {isHover ? (
                <circle
                  cx={star.x}
                  cy={star.z}
                  r={baseR * 2.2}
                  fill={spectralCss(star, 0.18)}
                  style={{ pointerEvents: "none" }}
                />
              ) : null}
              <circle
                cx={star.x}
                cy={star.z}
                r={baseR * 1.1}
                fill={spectralCss(star, 0.35)}
                style={{ pointerEvents: "none" }}
              />
              <circle
                cx={star.x}
                cy={star.z}
                r={baseR * 0.55}
                fill={spectralCss(star, 1)}
                style={{ pointerEvents: "none" }}
              />
              {isHover ? (
                <text
                  x={star.x}
                  y={star.z + baseR * 3}
                  textAnchor="middle"
                  dominantBaseline="hanging"
                  className="star-label"
                  style={{ fontSize: sizeScale * 0.018, pointerEvents: "none" }}
                  fill="#ffffff"
                >
                  {cluster.prefix}-{star.id}
                </text>
              ) : null}
            </g>
          );
        })}
        {homeStarId !== undefined && homeStarId !== null
          ? renderHomeMarker(galaxy, homeStarId, "cluster")
          : null}
      </svg>
      {clusterStars.length === 0 ? (
        <div className="empty-cluster">
          No stars landed in this cluster from the generator seed. Try
          another cluster.
        </div>
      ) : null}
    </div>
  );
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}
