"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Cluster, Galaxy, Sector, Star } from "@space-bros/shared";
import { Breadcrumb } from "./Breadcrumb";
import { ClusterMap } from "./ClusterMap";
import { GalaxyMap } from "./GalaxyMap";
import { NebulaBackground } from "./NebulaBackground";
import { SectorMap } from "./SectorMap";
import {
  type Bounds,
  clusterBounds as getClusterBounds,
  easeInOutCubic,
  galaxyBounds as getGalaxyBounds,
  lerpBounds,
  sectorBounds as getSectorBounds,
  zoomBounds,
} from "./map-helpers";

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
const ANIM_DURATION_MS = 350;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function MapRoot({ galaxy, onSelectStar, homeStarId }: Props) {
  const [view, setView] = useState<MapView>({ level: "galaxy" });
  const [zoom, setZoom] = useState(1);

  const sector: Sector | null = useMemo(() => {
    if (view.level === "galaxy") return null;
    return galaxy.sectors.find((s) => s.id === view.sectorId) ?? null;
  }, [galaxy, view]);

  const cluster: Cluster | null = useMemo(() => {
    if (view.level !== "cluster") return null;
    return galaxy.clusters.find((c) => c.id === view.clusterId) ?? null;
  }, [galaxy, view]);

  // The "natural" bounds for the current level = what the viewBox
  // should target when zoom=1. Animation lerps _displayBounds_ toward
  // this whenever the level changes.
  const naturalBounds = useMemo<Bounds>(() => {
    if (view.level === "galaxy") return getGalaxyBounds(galaxy, 1.02);
    if (view.level === "sector" && sector)
      return getSectorBounds(sector, galaxy, 1.12);
    if (view.level === "cluster" && cluster)
      return getClusterBounds(cluster, galaxy, 1.4);
    return getGalaxyBounds(galaxy, 1.02);
  }, [view, galaxy, sector, cluster]);

  // Animated bounds — smoothly morph when the level changes.
  const [displayBounds, setDisplayBounds] = useState<Bounds>(naturalBounds);
  const animRef = useRef<number | null>(null);
  const naturalRef = useRef(naturalBounds);

  useEffect(() => {
    // Kick off an animation from the current displayBounds to the new
    // target. If an animation is in progress we hijack it.
    const start = displayBounds;
    const end = naturalBounds;
    naturalRef.current = end;
    const startTime = performance.now();

    if (animRef.current !== null) cancelAnimationFrame(animRef.current);

    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / ANIM_DURATION_MS);
      const eased = easeInOutCubic(t);
      setDisplayBounds(lerpBounds(start, end, eased));
      if (t < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        animRef.current = null;
      }
    };

    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
    // Only re-run when naturalBounds actually changes (level change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalBounds]);

  // The camera-zoomed bounds handed to each map (and re-derived on
  // every zoom + bounds change). Zoom narrows `displayBounds` around
  // its center.
  const viewBounds = useMemo(() => {
    if (zoom === 1) return displayBounds;
    const cx = (displayBounds.minX + displayBounds.maxX) / 2;
    const cz = (displayBounds.minZ + displayBounds.maxZ) / 2;
    return zoomBounds(displayBounds, zoom, cx, cz);
  }, [displayBounds, zoom]);

  // Reset zoom when the level changes.
  const goView = useCallback((next: MapView) => {
    setZoom(1);
    setView(next);
  }, []);

  // ---- Gesture handling ---------------------------------------------------
  //
  // Desktop clicks were being eaten because we called
  // `setPointerCapture` on pointerdown, which stole the pointer from
  // the inner `<path>` — pointerup fired on the viewport, not the path,
  // and React never dispatched `onClick`. Fix: only capture AFTER a
  // drag passes the threshold. Plain clicks (down+up without movement)
  // never get captured and the SVG click flow works normally.

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "idle" }
    | {
        kind: "pan";
        startX: number;
        startY: number;
        startScreenPan: { x: number; y: number };
        moved: boolean;
        pointerId: number;
      }
    | {
        kind: "pinch";
        startDist: number;
        startZoom: number;
      }
  >({ kind: "idle" });
  const [screenPan, setScreenPan] = useState({ x: 0, y: 0 });
  const screenPanRef = useRef(screenPan);
  screenPanRef.current = screenPan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      gesture.current = {
        kind: "pinch",
        startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        startZoom: zoomRef.current,
      };
      // Capture both pointers so subsequent pointermove events still
      // route here even if fingers drift over child SVG elements.
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* nothing */
      }
    } else {
      gesture.current = {
        kind: "pan",
        startX: e.clientX,
        startY: e.clientY,
        startScreenPan: screenPanRef.current,
        moved: false,
        pointerId: e.pointerId,
      };
    }
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const next = clamp(g.startZoom * (dist / g.startDist), MIN_ZOOM, MAX_ZOOM);
      setZoom(next);
    } else if (g.kind === "pan" && g.pointerId === e.pointerId) {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (!g.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        g.moved = true;
        // Only now capture the pointer — allows clicks to reach inner
        // SVG elements while still supporting drag-to-pan.
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* nothing */
        }
      }
      if (g.moved) {
        setScreenPan({
          x: g.startScreenPan.x + dx,
          y: g.startScreenPan.y + dy,
        });
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
      gesture.current = { kind: "idle" };
    } else if (pointers.current.size === 1 && gesture.current.kind === "pinch") {
      const [first] = pointers.current.values();
      gesture.current = {
        kind: "pan",
        startX: first!.x,
        startY: first!.y,
        startScreenPan: screenPanRef.current,
        moved: true,
        pointerId: [...pointers.current.keys()][0]!,
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

  // Reset screen-pan when the level changes (new viewBox starts
  // centered).
  useEffect(() => {
    setScreenPan({ x: 0, y: 0 });
  }, [view.level, view.level === "sector" ? view.sectorId : "", view.level === "cluster" ? view.clusterId : ""]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <button
          onClick={onZoomIn}
          aria-label="Zoom in"
          disabled={zoom >= MAX_ZOOM - 0.001}
        >
          +
        </button>
        <div className="zoom-level">{Math.round(zoom * 100)}%</div>
        <button
          onClick={onZoomOut}
          aria-label="Zoom out"
          disabled={zoom <= MIN_ZOOM + 0.001}
        >
          −
        </button>
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
            transform: `translate3d(${screenPan.x}px, ${screenPan.y}px, 0) rotateX(${PITCH_DEG}deg)`,
          }}
        >
          {view.level === "galaxy" ? (
            <GalaxyMap
              galaxy={galaxy}
              bounds={viewBounds}
              homeStarId={homeStarId}
              onSelectSector={(s: Sector) =>
                goView({ level: "sector", sectorId: s.id })
              }
            />
          ) : null}
          {view.level === "sector" && sector ? (
            <SectorMap
              galaxy={galaxy}
              sector={sector}
              bounds={viewBounds}
              homeStarId={homeStarId}
              onSelectCluster={(c: Cluster) =>
                goView({
                  level: "cluster",
                  sectorId: sector.id,
                  clusterId: c.id,
                })
              }
            />
          ) : null}
          {view.level === "cluster" && sector && cluster ? (
            <ClusterMap
              galaxy={galaxy}
              sector={sector}
              cluster={cluster}
              bounds={viewBounds}
              homeStarId={homeStarId}
              onSelectStar={onSelectStar}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
