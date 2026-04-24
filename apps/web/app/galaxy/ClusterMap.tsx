"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Cluster, Galaxy, Sector, Star } from "@space-bros/shared";
import {
  SPECTRAL_RGB,
  clusterBounds,
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
  onSelectStar: (star: Star) => void;
  homeStarId?: number | null;
}

const CANVAS_SIZE = 1200;

export function ClusterMap({ galaxy, sector, cluster, onSelectStar, homeStarId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bounds = useMemo(() => clusterBounds(cluster, galaxy, 1.3), [cluster, galaxy]);
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

    // Faint dust backdrop for atmosphere.
    for (const d of dust) {
      const { px, py } = project(d.x, d.z, bounds, CANVAS_SIZE, CANVAS_SIZE);
      if (px < -10 || py < -10 || px > CANVAS_SIZE + 10 || py > CANVAS_SIZE + 10) continue;
      ctx.fillStyle = `${d.color}${d.alpha * 0.6})`;
      ctx.beginPath();
      ctx.arc(px, py, 1.5, 0, Math.PI * 2);
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
      (cluster.spread * 5) /
      (bounds.maxX - bounds.minX) *
      CANVAS_SIZE;
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
        {/* Cluster boundary ring. */}
        <circle
          cx={cluster.center.x}
          cy={cluster.center.z}
          r={cluster.spread * 3}
          fill="none"
          stroke={color}
          strokeOpacity={0.3}
          strokeDasharray={`${galaxy.radius * 0.006} ${galaxy.radius * 0.004}`}
          strokeWidth={galaxy.radius * 0.002}
        />
        {/* Big clickable stars. */}
        {clusterStars.map((star) => {
          const isHover = hover?.id === star.id;
          const sizeScale = bounds.maxX - bounds.minX;
          const baseR = sizeScale * 0.012;
          return (
            <g
              key={star.id}
              className="cluster-star"
              onClick={() => onSelectStar(star)}
              onMouseEnter={() => setHover(star)}
              onMouseLeave={() => setHover((h) => (h?.id === star.id ? null : h))}
              role="button"
              tabIndex={0}
            >
              {/* Invisible fat hit target for easy clicking. */}
              <circle
                cx={star.x}
                cy={star.z}
                r={baseR * 2.5}
                fill="transparent"
              />
              {isHover ? (
                <circle
                  cx={star.x}
                  cy={star.z}
                  r={baseR * 2.2}
                  fill={spectralCss(star, 0.18)}
                />
              ) : null}
              <circle
                cx={star.x}
                cy={star.z}
                r={baseR * 1.1}
                fill={spectralCss(star, 0.35)}
              />
              <circle
                cx={star.x}
                cy={star.z}
                r={baseR * 0.55}
                fill={spectralCss(star, 1)}
              />
              {isHover ? (
                <text
                  x={star.x}
                  y={star.z + baseR * 3}
                  textAnchor="middle"
                  dominantBaseline="hanging"
                  className="star-label"
                  style={{ fontSize: sizeScale * 0.018 }}
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
          No stars landed in this cluster from the generator seed.
          Try another cluster.
        </div>
      ) : null}
    </div>
  );
}

const _rgbPrefix: typeof SPECTRAL_RGB = SPECTRAL_RGB; // keep import alive for tree-shaker
void _rgbPrefix;
