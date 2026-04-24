"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Cluster, Galaxy, Group, Sector, Star } from "@space-bros/shared";
import { CameraFocus } from "./CameraFocus";
import { Clusters3D } from "./Clusters3D";
import { Groups3D } from "./Groups3D";
import { HomeMarker3D } from "./HomeMarker3D";
import { Sectors3D, computeSectorBounds } from "./Sectors3D";
import { SelectedStarMarker3D } from "./SelectedStarMarker3D";
import { Stars3D } from "./Stars3D";
import { extractBorders } from "./borders";

interface Props {
  galaxy: Galaxy;
  homeStarId?: number | null;
}

type ViewLevel = "galaxy" | "sector" | "cluster" | "group";

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

  const viewLevel: ViewLevel = selectedGroup
    ? "group"
    : selectedCluster
    ? "cluster"
    : selectedSector
    ? "sector"
    : "galaxy";

  const sectorBounds = useMemo(() => computeSectorBounds(galaxy), [galaxy]);
  const borders = useMemo(() => extractBorders(galaxy), [galaxy]);

  // Selectable stars at group level: only those belonging to the
  // selected group. Everywhere else Stars3D ignores clicks.
  const selectableStarIds = useMemo(() => {
    if (!selectedGroup) return null;
    const set = new Set<number>();
    for (const s of galaxy.stars) {
      if (s.groupId === selectedGroup.id) set.add(s.id);
    }
    return set;
  }, [galaxy, selectedGroup]);

  const focusTarget = useMemo(() => {
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
    selectedStarId,
    selectedGroup,
    selectedCluster,
    selectedSector,
    galaxy,
    defaultTarget,
  ]);

  const focusDistance = useMemo(() => {
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
    selectedStarId,
    selectedGroup,
    selectedCluster,
    selectedSector,
    sectorBounds,
    r,
    defaultDistance,
  ]);

  // Pop one level at a time on the × button or empty-space click.
  const popLevel = () => {
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
    popLevel();
  };

  // Cursor feedback: differentiate rotate (left) vs pan (right) while
  // dragging. Default is grab.
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

  return (
    <>
      <Canvas
        className="scene-canvas"
        camera={{
          position: [0, r * 0.9, r * 1.35],
          fov: 55,
          near: r * 0.005,
          far: r * 12,
        }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        <ambientLight intensity={0.4} />

        {/* Invisible backdrop for empty-space click to pop a level. */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -2, 0]}
          onClick={onBackgroundClick}
        >
          <planeGeometry args={[r * 6, r * 6]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

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

        {selectedSector ? (
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

        {selectedCluster ? (
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

        <Stars3D
          galaxy={galaxy}
          onSelectStar={(s: Star) => setSelectedStarId(s.id)}
          active={viewLevel === "group"}
          selectableStarIds={selectableStarIds}
        />

        {homeStarId != null ? (
          <HomeMarker3D galaxy={galaxy} starId={homeStarId} />
        ) : null}

        {selectedStarId != null ? (
          <SelectedStarMarker3D galaxy={galaxy} starId={selectedStarId} />
        ) : null}

        <CameraFocus target={focusTarget} distance={focusDistance} pitch={0.55} />

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          enablePan
          panSpeed={0.7}
          rotateSpeed={0.5}
          zoomSpeed={1.0}
          minDistance={r * 0.015}
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
        starId={selectedStarId}
        galaxy={galaxy}
        onPop={popLevel}
      />
    </>
  );
}

interface LevelPillProps {
  viewLevel: ViewLevel;
  sector: Sector | null;
  cluster: Cluster | null;
  group: Group | null;
  starId: number | null;
  galaxy: Galaxy;
  onPop: () => void;
}

function LevelPill({
  viewLevel,
  sector,
  cluster,
  group,
  starId,
  galaxy,
  onPop,
}: LevelPillProps) {
  if (viewLevel === "galaxy" && starId == null) return null;

  // Composing the label hierarchically: Star → Group → Cluster → Sector.
  const star = starId != null ? galaxy.stars[starId] : null;

  let title = "";
  let meta = "";

  if (star) {
    const sectorName =
      galaxy.sectors.find((s) => s.id === star.sectorId)?.name ?? "—";
    const clusterName =
      galaxy.clusters.find((c) => c.id === star.clusterId)?.name ?? "—";
    title = `Star #${star.id}`;
    meta = `${star.spectralClass}-class · ${star.planets.length} planet${
      star.planets.length === 1 ? "" : "s"
    } · ${clusterName} / ${sectorName}`;
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
      <button onClick={onPop} aria-label="Back">×</button>
    </div>
  );
}
