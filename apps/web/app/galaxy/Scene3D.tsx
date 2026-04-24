"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Cluster, Galaxy, Group, Planet, Sector, Star } from "@space-bros/shared";
import { CameraFocus } from "./CameraFocus";
import { Clusters3D } from "./Clusters3D";
import { Groups3D } from "./Groups3D";
import { HomeMarker3D } from "./HomeMarker3D";
import { Sectors3D, computeSectorBounds } from "./Sectors3D";
import { SelectedStarMarker3D } from "./SelectedStarMarker3D";
import { SolarSystem3D, solarSystemMaxOrbit } from "./SolarSystem3D";
import { StarAltitudeLines3D } from "./StarAltitudeLines3D";
import { Stars3D } from "./Stars3D";
import { extractBorders } from "./borders";

interface Props {
  galaxy: Galaxy;
  homeStarId?: number | null;
}

type ViewLevel =
  | "galaxy"
  | "sector"
  | "cluster"
  | "group"
  | "star"
  | "solar"
  | "planet";

export function Scene3D({ galaxy, homeStarId }: Props) {
  const r = galaxy.radius;
  const defaultTarget = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const defaultDistance = r * 1.6;

  const [hoveredSectorId, setHoveredSectorId] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState<Sector | null>(null);
  const [hoveredClusterId, setHoveredClusterId] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [selectedStarId, setSelectedStarId] = useState<number | null>(null);
  const [inSolarSystem, setInSolarSystem] = useState(false);
  const [hoveredPlanetId, setHoveredPlanetId] = useState<string | null>(null);
  const [selectedPlanet, setSelectedPlanet] = useState<Planet | null>(null);
  // World position of the selected planet at click time. The planet's
  // orbit is paused while selected (see SolarSystem3D), so this stays
  // accurate until the player deselects.
  const [selectedPlanetPos, setSelectedPlanetPos] =
    useState<THREE.Vector3 | null>(null);

  const viewLevel: ViewLevel =
    inSolarSystem && selectedPlanet
      ? "planet"
      : inSolarSystem
      ? "solar"
      : selectedStarId != null
      ? "star"
      : selectedGroup
      ? "group"
      : selectedCluster
      ? "cluster"
      : selectedSector
      ? "sector"
      : "galaxy";

  const sectorBounds = useMemo(() => computeSectorBounds(galaxy), [galaxy]);
  const borders = useMemo(() => extractBorders(galaxy), [galaxy]);

  // Star-id sets per active parent so altitude lines can render
  // only the stars at the current zoom level.
  const sectorStarIds = useMemo(() => {
    if (!selectedSector) return new Set<number>();
    const set = new Set<number>();
    for (const s of galaxy.stars) {
      if (s.sectorId === selectedSector.id) set.add(s.id);
    }
    return set;
  }, [galaxy, selectedSector]);

  const clusterStarIds = useMemo(() => {
    if (!selectedCluster) return new Set<number>();
    const set = new Set<number>();
    for (const s of galaxy.stars) {
      if (s.clusterId === selectedCluster.id) set.add(s.id);
    }
    return set;
  }, [galaxy, selectedCluster]);

  const groupStarIds = useMemo(() => {
    if (!selectedGroup) return new Set<number>();
    const set = new Set<number>();
    for (const s of galaxy.stars) {
      if (s.groupId === selectedGroup.id) set.add(s.id);
    }
    return set;
  }, [galaxy, selectedGroup]);

  const altitudeStarIds: ReadonlySet<number> = selectedGroup
    ? groupStarIds
    : selectedCluster
    ? clusterStarIds
    : selectedSector
    ? sectorStarIds
    : new Set();

  // Target + distance per viewLevel.
  const focusTarget = useMemo(() => {
    if (inSolarSystem && selectedPlanet && selectedPlanetPos) {
      return selectedPlanetPos;
    }
    if (inSolarSystem && selectedStarId != null) {
      const s = galaxy.stars[selectedStarId];
      if (s) return new THREE.Vector3(s.x, s.y, s.z);
    }
    if (selectedStarId != null) {
      const s = galaxy.stars[selectedStarId];
      if (s) return new THREE.Vector3(s.x, 0, s.z);
    }
    if (selectedGroup) {
      return new THREE.Vector3(selectedGroup.centroid[0], 0, selectedGroup.centroid[1]);
    }
    if (selectedCluster) {
      return new THREE.Vector3(selectedCluster.centroid[0], 0, selectedCluster.centroid[1]);
    }
    if (selectedSector) {
      return new THREE.Vector3(selectedSector.centroid[0], 0, selectedSector.centroid[1]);
    }
    return defaultTarget;
  }, [
    inSolarSystem,
    selectedPlanet,
    selectedPlanetPos,
    selectedStarId,
    selectedGroup,
    selectedCluster,
    selectedSector,
    galaxy,
    defaultTarget,
  ]);

  const focusDistance = useMemo(() => {
    if (inSolarSystem && selectedPlanet) {
      // Planet radii run 1.7–4.6 after the V-2.9 scale bump. A fixed
      // distance of ~14 frames any planet tightly without clipping.
      return Math.max(10, selectedPlanet.size * 6.5);
    }
    if (inSolarSystem && selectedStarId != null) {
      const s = galaxy.stars[selectedStarId];
      if (s) return Math.max(8, solarSystemMaxOrbit(s) * 2.4);
    }
    if (selectedStarId != null) return Math.max(r * 0.02, 6);
    if (selectedGroup) return Math.max(r * 0.035, 12);
    if (selectedCluster) {
      const count = selectedCluster.groupIds.length;
      return Math.max(r * 0.08, Math.sqrt(count) * r * 0.03);
    }
    if (selectedSector) {
      const b = sectorBounds.get(selectedSector.id);
      if (!b) return defaultDistance;
      const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
      return Math.max(r * 0.18, span * 1.3);
    }
    return defaultDistance;
  }, [
    inSolarSystem,
    selectedPlanet,
    selectedStarId,
    selectedGroup,
    selectedCluster,
    selectedSector,
    sectorBounds,
    galaxy,
    r,
    defaultDistance,
  ]);

  // Distance above which "zoom out" triggers the popper. Set to
  // 1.6 × the current level's own focus distance so zooming back out
  // past your own frame by a comfortable margin pops you up.
  // Infinity at galaxy level (no parent to pop to).
  const zoomOutTrigger = useMemo(() => {
    if (viewLevel === "galaxy") return Infinity;
    return focusDistance * 1.6;
  }, [viewLevel, focusDistance]);

  const popLevel = () => {
    if (inSolarSystem && selectedPlanet) {
      setSelectedPlanet(null);
      setSelectedPlanetPos(null);
      setHoveredPlanetId(null);
      return;
    }
    if (inSolarSystem) {
      setInSolarSystem(false);
      setSelectedPlanet(null);
      setSelectedPlanetPos(null);
      setHoveredPlanetId(null);
      return;
    }
    if (selectedStarId != null) {
      setSelectedStarId(null);
      return;
    }
    if (selectedGroup) {
      setSelectedGroup(null);
      setHoveredGroupId(null);
      return;
    }
    if (selectedCluster) {
      setSelectedCluster(null);
      setHoveredClusterId(null);
      return;
    }
    if (selectedSector) {
      setSelectedSector(null);
      setHoveredSectorId(null);
    }
  };

  const onBackgroundClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.eventObject !== e.intersections[0]?.object) return;
    // While in solar system view, ignore clicks that land on the empty
    // background plane — planets are small targets and grazing misses
    // were popping the user back out to galaxy view. They can still
    // exit via the level-pill × button or by zooming out.
    if (inSolarSystem) return;
    popLevel();
  };

  // Cursor feedback: left = grabbing (rotate), right = move (pan).
  useEffect(() => {
    const canvas = document.querySelector(".scene-canvas") as HTMLElement | null;
    if (!canvas) return;
    const onDown = (e: PointerEvent) => {
      if (e.button === 2) canvas.style.cursor = "move";
      else if (e.button === 0) canvas.style.cursor = "grabbing";
    };
    const onUp = () => {
      canvas.style.cursor = "grab";
    };
    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onUp);
    };
  }, []);

  const clusterEdgesForSelected = selectedSector
    ? borders.clusterEdgesBySector.get(selectedSector.id)
    : undefined;
  const groupEdgesForSelected = selectedCluster
    ? borders.groupEdgesByCluster.get(selectedCluster.id)
    : undefined;

  const selectedStar =
    selectedStarId != null ? galaxy.stars[selectedStarId] ?? null : null;

  return (
    <>
      <Canvas
        className="scene-canvas"
        camera={{
          position: [0, r * 0.9, r * 1.35],
          fov: 55,
          near: r * 0.003,
          far: r * 12,
        }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        <ambientLight intensity={0.4} />

        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -2, 0]}
          onClick={onBackgroundClick}
        >
          <planeGeometry args={[r * 6, r * 6]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {!inSolarSystem ? (
          <Sectors3D
            galaxy={galaxy}
            hoveredSectorId={hoveredSectorId}
            selectedSectorId={selectedSector?.id ?? null}
            onHoverSector={(s) => setHoveredSectorId(s?.id ?? null)}
            onSelectSector={(s) => {
              setSelectedSector(s);
              setSelectedCluster(null);
              setSelectedGroup(null);
              setSelectedStarId(null);
            }}
            sectorEdges={borders.sectorEdges}
            rimEdges={borders.rimEdges}
            active={viewLevel === "galaxy"}
          />
        ) : null}

        {selectedSector && !inSolarSystem ? (
          <Clusters3D
            galaxy={galaxy}
            sector={selectedSector}
            hoveredClusterId={hoveredClusterId}
            selectedClusterId={selectedCluster?.id ?? null}
            onHoverCluster={(c) => setHoveredClusterId(c?.id ?? null)}
            onSelectCluster={(c) => {
              setSelectedCluster(c);
              setSelectedGroup(null);
              setSelectedStarId(null);
            }}
            clusterEdges={clusterEdgesForSelected}
            active={viewLevel === "sector"}
          />
        ) : null}

        {selectedCluster && !inSolarSystem ? (
          <Groups3D
            galaxy={galaxy}
            cluster={selectedCluster}
            hoveredGroupId={hoveredGroupId}
            selectedGroupId={selectedGroup?.id ?? null}
            onHoverGroup={(g) => setHoveredGroupId(g?.id ?? null)}
            onSelectGroup={(g) => {
              setSelectedGroup(g);
              setSelectedStarId(null);
            }}
            groupEdges={groupEdgesForSelected}
            active={viewLevel === "cluster"}
          />
        ) : null}

        {altitudeStarIds.size > 0 && !inSolarSystem ? (
          <StarAltitudeLines3D
            galaxy={galaxy}
            starIds={altitudeStarIds}
            opacity={selectedGroup ? 0.55 : selectedCluster ? 0.4 : 0.22}
          />
        ) : null}

        {!inSolarSystem ? (
          <Stars3D
            galaxy={galaxy}
            onSelectStar={(s: Star) => setSelectedStarId(s.id)}
            active={viewLevel === "group"}
            selectableStarIds={
              viewLevel === "group" ? groupStarIds : null
            }
          />
        ) : null}

        {homeStarId != null && !inSolarSystem ? (
          <HomeMarker3D galaxy={galaxy} starId={homeStarId} />
        ) : null}

        {selectedStarId != null && !inSolarSystem ? (
          <SelectedStarMarker3D galaxy={galaxy} starId={selectedStarId} />
        ) : null}

        {inSolarSystem && selectedStar ? (
          <SolarSystem3D
            star={selectedStar}
            hoveredPlanetId={hoveredPlanetId}
            selectedPlanetId={selectedPlanet?.id ?? null}
            onHoverPlanet={(p) => setHoveredPlanetId(p?.id ?? null)}
            onSelectPlanet={(p, pos) => {
              setSelectedPlanet(p);
              setSelectedPlanetPos(pos.clone());
            }}
          />
        ) : null}

        <CameraFocus target={focusTarget} distance={focusDistance} pitch={0.55} />
        <ZoomOutPopper triggerDistance={zoomOutTrigger} onPop={popLevel} />

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          enablePan
          panSpeed={0.7}
          rotateSpeed={0.5}
          zoomSpeed={1.0}
          minDistance={r * 0.008}
          maxDistance={r * 3.2}
          maxPolarAngle={Math.PI * 0.49}
          minPolarAngle={Math.PI * 0.12}
        />
      </Canvas>

      <LevelPill
        viewLevel={viewLevel}
        sector={selectedSector}
        cluster={selectedCluster}
        group={selectedGroup}
        star={selectedStar}
        planet={selectedPlanet}
        galaxy={galaxy}
        onPop={popLevel}
        onEnterSolar={() => {
          if (selectedStarId != null) setInSolarSystem(true);
        }}
      />
    </>
  );
}

interface ZoomOutPopperProps {
  /** Camera distance above which we start counting toward a pop. */
  triggerDistance: number;
  onPop: () => void;
}

/**
 * Watches the orbit-controls camera distance. Once the user has
 * scrolled further out than `triggerDistance` for ~15 consecutive
 * frames (~0.25 s), pops up one level.
 *
 * Frame-count hysteresis keeps brief overshoots from firing, but we
 * intentionally drop the "has CameraFocus settled?" gate that the
 * previous revision had — the one-shot CameraFocus releases control
 * once it lands, so any sustained big distance after that is a real
 * user zoom-out.
 */
function ZoomOutPopper({ triggerDistance, onPop }: ZoomOutPopperProps) {
  const camera = useThree((s) => s.camera);
  const controls = useThree(
    (s) => s.controls as unknown as { target: THREE.Vector3 } | null,
  );
  const frames = useRef(0);
  const hasReached = useRef(false);

  // Reset "has the camera arrived at this level's frame?" whenever the
  // trigger changes (i.e. we switched levels). Prevents the popper
  // from firing during the zoom-IN animation from the parent level.
  useEffect(() => {
    hasReached.current = false;
    frames.current = 0;
  }, [triggerDistance]);

  useFrame(() => {
    if (!controls) {
      frames.current = 0;
      return;
    }
    if (!Number.isFinite(triggerDistance) || triggerDistance <= 0) {
      frames.current = 0;
      return;
    }
    const dist = camera.position.distanceTo(controls.target);

    // Infer the level's focus distance from the trigger. Mark the
    // camera as "arrived" once it drops below 1.25 × that, meaning the
    // zoom-in animation has landed and any further outward motion is
    // a genuine user zoom-out.
    const focusDistance = triggerDistance / 1.6;
    if (!hasReached.current && dist < focusDistance * 1.25) {
      hasReached.current = true;
    }

    if (hasReached.current && dist > triggerDistance) {
      frames.current += 1;
      if (frames.current >= 15) {
        frames.current = 0;
        onPop();
      }
    } else {
      frames.current = 0;
    }
  });

  return null;
}

interface LevelPillProps {
  viewLevel: ViewLevel;
  sector: Sector | null;
  cluster: Cluster | null;
  group: Group | null;
  star: Star | null;
  planet: Planet | null;
  galaxy: Galaxy;
  onPop: () => void;
  onEnterSolar: () => void;
}

function LevelPill({
  viewLevel,
  sector,
  cluster,
  group,
  star,
  planet,
  galaxy,
  onPop,
  onEnterSolar,
}: LevelPillProps) {
  if (viewLevel === "galaxy") return null;

  let title = "";
  let meta = "";
  let action: React.ReactNode = null;

  if (planet && viewLevel === "solar" && star) {
    const habPct = Math.round(planet.habitability * 100);
    title = `Planet ${planet.index + 1}`;
    meta = `${planet.biome} · ${planet.orbitAu.toFixed(1)} AU · hab ${habPct}%`;
  } else if (viewLevel === "solar" && star) {
    const designation = starDesignation(star, galaxy);
    title = designation;
    meta = `${star.spectralClass}-class · ${star.planets.length} planet${
      star.planets.length === 1 ? "" : "s"
    } · solar system view`;
  } else if (star) {
    const designation = starDesignation(star, galaxy);
    const clusterName =
      galaxy.clusters.find((c) => c.id === star.clusterId)?.name ?? "—";
    const sectorName =
      galaxy.sectors.find((s) => s.id === star.sectorId)?.name ?? "—";
    title = designation;
    meta = `${star.spectralClass}-class · ${star.planets.length} planet${
      star.planets.length === 1 ? "" : "s"
    } · ${clusterName} / ${sectorName}`;
    action = (
      <button className="pill-action" onClick={onEnterSolar}>
        View Solar System →
      </button>
    );
  } else if (group) {
    const starCount = galaxy.stars.reduce(
      (n, s) => (s.groupId === group.id ? n + 1 : n),
      0,
    );
    const clusterName =
      galaxy.clusters.find((c) => c.id === group.clusterId)?.name ?? "—";
    title = `Group · ${group.id.replace(/^grp_/, "#")}`;
    meta = `${starCount} star${starCount === 1 ? "" : "s"} · in ${clusterName}`;
  } else if (cluster) {
    const starCount = galaxy.stars.reduce(
      (n, s) => (s.clusterId === cluster.id ? n + 1 : n),
      0,
    );
    const sectorName =
      galaxy.sectors.find((s) => s.id === cluster.sectorId)?.name ?? "—";
    title = cluster.name;
    meta = `${cluster.groupIds.length} groups · ${starCount.toLocaleString()} stars · in ${sectorName}`;
  } else if (sector) {
    const starCount = galaxy.stars.reduce(
      (n, s) => (s.sectorId === sector.id ? n + 1 : n),
      0,
    );
    title = sector.name;
    meta = `${sector.clusterIds.length} clusters · ${starCount.toLocaleString()} stars · ${sector.prefix}`;
  }

  return (
    <div className="sector-pill">
      <div>
        <div className="sector-pill-title">{title}</div>
        <div className="sector-pill-meta">{meta}</div>
      </div>
      {action}
      <button onClick={onPop} aria-label="Back">×</button>
    </div>
  );
}

function starDesignation(star: Star, galaxy: Galaxy): string {
  const cluster = galaxy.clusters.find((c) => c.id === star.clusterId);
  const code = cluster?.code ?? "—";
  return `${code}-${String(star.id).padStart(4, "0")}`;
}
