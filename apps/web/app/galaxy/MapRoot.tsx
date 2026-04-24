"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  homeStarId?: number | null;
}

const DRAG_THRESHOLD_PX = 5;
const PITCH_DEG = 42;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function MapRoot({ galaxy, onSelectStar, homeStarId }: Props) {
  const [view, setView] = useState<MapView>({ level: "galaxy" });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  const sector: Sector | null = useMemo(() => {
    if (view.level === "galaxy") return null;
    return galaxy.sectors.find((s) => s.id === view.sectorId) ?? null;
  }, [galaxy, view]);

  const cluster: Cluster | null = useMemo(() => {
    if (view.level !== "cluster") return null;
    return galaxy.clusters.find((c) => c.id === view.clusterId) ?? null;
  }, [galaxy, view]);

  // Reset pan + zoom when the level changes.
  const goView = useCallback((next: MapView) => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setView(next);
  }, []);

  // Gesture state.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "none" }
    | {
        kind: "pan";
        startX: number;
        startY: number;
        startPan: { x: number; y: number };
        moved: boolean;
      }
    | {
        kind: "pinch";
        startDist: number;
        startZoom: number;
      }
  >({ kind: "none" });
  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      gesture.current = {
        kind: "pinch",
        startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        startZoom: zoomRef.current,
      };
    } else if (pointers.current.size === 1) {
      gesture.current = {
        kind: "pan",
        startX: e.clientX,
        startY: e.clientY,
        startPan: panRef.current,
        moved: false,
      };
    }
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const g = gesture.current;
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const next = clamp(
        g.startZoom * (dist / g.startDist),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      setZoom(next);
    } else if (g.kind === "pan" && pointers.current.size === 1) {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (!g.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        g.moved = true;
      }
      if (g.moved) {
        setPan({ x: g.startPan.x + dx, y: g.startPan.y + dy });
      }
    }
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* nothing */
    }
    if (pointers.current.size === 0) {
      // keep gesture as "pan" briefly so guardClick can see the moved flag;
      // next pointerdown will replace it.
      if (gesture.current.kind !== "pan") {
        gesture.current = { kind: "none" };
      }
    } else if (pointers.current.size === 1 && gesture.current.kind === "pinch") {
      // Dropped one finger during pinch — resume pan from current pos.
      const [first] = pointers.current.values();
      gesture.current = {
        kind: "pan",
        startX: first!.x,
        startY: first!.y,
        startPan: panRef.current,
        moved: true,
      };
    }
  }, []);

  const viewportRef = useRef<HTMLDivElement>(null);

  // Wheel zoom — desktop. Attach non-passive so preventDefault works.
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.0015;
      setZoom((z) => clamp(z * Math.exp(delta), MIN_ZOOM, MAX_ZOOM));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  // Guard click handlers: ignore when a drag moved past threshold.
  const guardClick = useCallback(<T extends unknown[]>(fn: (...args: T) => void) => {
    return (...args: T) => {
      const g = gesture.current;
      if (g.kind === "pan" && g.moved) return;
      fn(...args);
    };
  }, []);

  const onZoomIn = () => setZoom((z) => clamp(z * 1.3, MIN_ZOOM, MAX_ZOOM));
  const onZoomOut = () => setZoom((z) => clamp(z / 1.3, MIN_ZOOM, MAX_ZOOM));

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
      <div className="zoom-controls">
        <button onClick={onZoomIn} aria-label="Zoom in" disabled={zoom >= MAX_ZOOM - 0.001}>+</button>
        <div className="zoom-level">{Math.round(zoom * 100)}%</div>
        <button onClick={onZoomOut} aria-label="Zoom out" disabled={zoom <= MIN_ZOOM + 0.001}>−</button>
      </div>
      <div
        ref={viewportRef}
        className="map-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="map-stage"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom}) rotateX(${PITCH_DEG}deg)`,
          }}
        >
          {view.level === "galaxy" ? (
            <GalaxyMap
              galaxy={galaxy}
              homeStarId={homeStarId}
              onSelectSector={guardClick((s: Sector) =>
                goView({ level: "sector", sectorId: s.id }),
              )}
            />
          ) : null}
          {view.level === "sector" && sector ? (
            <SectorMap
              galaxy={galaxy}
              sector={sector}
              homeStarId={homeStarId}
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
              homeStarId={homeStarId}
              onSelectStar={guardClick(onSelectStar)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
