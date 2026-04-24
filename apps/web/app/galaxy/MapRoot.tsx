"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Cluster, Galaxy, Sector, Star } from "@space-bros/shared";
import { Breadcrumb } from "./Breadcrumb";
import { ClusterMap } from "./ClusterMap";
import { GalaxyMap } from "./GalaxyMap";
import { NebulaBackground } from "./NebulaBackground";
import { SectorMap } from "./SectorMap";

type MapView =
  | { level: "galaxy" }
  | { level: "sector"; sectorId: string }
  | { level: "cluster"; sectorId: string; clusterId: string };

interface Props {
  galaxy: Galaxy;
  onSelectStar: (star: Star) => void;
}

const DRAG_THRESHOLD_PX = 5;
const PITCH_DEG = 42;

export function MapRoot({ galaxy, onSelectStar }: Props) {
  const [view, setView] = useState<MapView>({ level: "galaxy" });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    startPan: { x: 0, y: 0 },
  });

  const sector: Sector | null = useMemo(() => {
    if (view.level === "galaxy") return null;
    return galaxy.sectors.find((s) => s.id === view.sectorId) ?? null;
  }, [galaxy, view]);

  const cluster: Cluster | null = useMemo(() => {
    if (view.level !== "cluster") return null;
    return galaxy.clusters.find((c) => c.id === view.clusterId) ?? null;
  }, [galaxy, view]);

  // Reset pan when the level changes.
  const goView = useCallback((next: MapView) => {
    setPan({ x: 0, y: 0 });
    setView(next);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragging.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      startPan: pan,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [pan]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragging.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) d.moved = true;
    if (d.moved) {
      setPan({ x: d.startPan.x + dx, y: d.startPan.y + dy });
    }
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current.active = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* nothing */
    }
  }, []);

  /**
   * Click handlers on sectors/clusters/stars only fire when the user
   * didn't drag. Guards against "tried to pan, ended up navigating."
   */
  const guardClick = useCallback(<T extends unknown[]>(
    fn: (...args: T) => void,
  ) => {
    return (...args: T) => {
      if (dragging.current.moved) return;
      fn(...args);
    };
  }, []);

  return (
    <div className="map-root">
      <NebulaBackground />
      <Breadcrumb
        sector={sector}
        cluster={cluster}
        onGoGalaxy={() => goView({ level: "galaxy" })}
        onGoSector={() =>
          sector ? goView({ level: "sector", sectorId: sector.id }) : undefined
        }
      />
      <div
        className="map-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="map-stage"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) rotateX(${PITCH_DEG}deg)`,
          }}
        >
          {view.level === "galaxy" ? (
            <GalaxyMap
              galaxy={galaxy}
              onSelectSector={guardClick((s: Sector) =>
                goView({ level: "sector", sectorId: s.id }),
              )}
            />
          ) : null}
          {view.level === "sector" && sector ? (
            <SectorMap
              galaxy={galaxy}
              sector={sector}
              onSelectCluster={guardClick((c: Cluster) =>
                goView({
                  level: "cluster",
                  sectorId: sector.id,
                  clusterId: c.id,
                }),
              )}
            />
          ) : null}
          {view.level === "cluster" && sector && cluster ? (
            <ClusterMap
              galaxy={galaxy}
              sector={sector}
              cluster={cluster}
              onSelectStar={guardClick(onSelectStar)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
