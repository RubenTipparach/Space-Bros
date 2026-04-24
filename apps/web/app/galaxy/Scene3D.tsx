"use client";

import { useMemo, useState } from "react";
import * as THREE from "three";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Cluster, Galaxy, Sector, Star } from "@space-bros/shared";
import { CameraFocus } from "./CameraFocus";
import { Clusters3D } from "./Clusters3D";
import { HomeMarker3D } from "./HomeMarker3D";
import { Sectors3D, computeSectorBounds } from "./Sectors3D";
import { Stars3D } from "./Stars3D";
import { extractBorders } from "./borders";

interface Props {
  galaxy: Galaxy;
  onSelectStar: (star: Star) => void;
  homeStarId?: number | null;
}

export function Scene3D({ galaxy, onSelectStar, homeStarId }: Props) {
  const r = galaxy.radius;
  const defaultTarget = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const defaultDistance = r * 1.6;

  const [hoveredSectorId, setHoveredSectorId] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState<Sector | null>(null);
  const [hoveredClusterId, setHoveredClusterId] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);

  const sectorBounds = useMemo(() => computeSectorBounds(galaxy), [galaxy]);
  const borders = useMemo(() => extractBorders(galaxy), [galaxy]);

  const focusTarget = useMemo(() => {
    if (selectedCluster) {
      return new THREE.Vector3(selectedCluster.centroid[0], 0, selectedCluster.centroid[1]);
    }
    if (!selectedSector) return defaultTarget;
    const c = selectedSector.centroid;
    return new THREE.Vector3(c[0], 0, c[1]);
  }, [selectedSector, selectedCluster, defaultTarget]);

  const focusDistance = useMemo(() => {
    if (selectedCluster) {
      // Rough cluster radius — sqrt of cluster star count × scale.
      const count = selectedCluster.groupIds.length;
      return Math.max(r * 0.06, Math.sqrt(count) * r * 0.025);
    }
    if (!selectedSector) return defaultDistance;
    const b = sectorBounds.get(selectedSector.id);
    if (!b) return defaultDistance;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    return Math.max(r * 0.18, span * 1.4);
  }, [selectedSector, selectedCluster, sectorBounds, r, defaultDistance]);

  const onBackgroundClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.eventObject === e.intersections[0]?.object) {
      if (selectedCluster) setSelectedCluster(null);
      else setSelectedSector(null);
    }
  };

  const clusterEdgesForSelected = selectedSector
    ? borders.clusterEdgesBySector.get(selectedSector.id)
    : undefined;

  return (
    <>
      <Canvas
        className="scene-canvas"
        camera={{
          position: [0, r * 0.9, r * 1.35],
          fov: 55,
          near: r * 0.01,
          far: r * 12,
        }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        <ambientLight intensity={0.4} />

        {/* Invisible backdrop so clicks on empty space can deselect. */}
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
          }}
          sectorEdges={borders.sectorEdges}
          rimEdges={borders.rimEdges}
        />

        {selectedSector ? (
          <Clusters3D
            galaxy={galaxy}
            sector={selectedSector}
            hoveredClusterId={hoveredClusterId}
            selectedClusterId={selectedCluster?.id ?? null}
            onHoverCluster={(c) => setHoveredClusterId(c?.id ?? null)}
            onSelectCluster={setSelectedCluster}
            clusterEdges={clusterEdgesForSelected}
          />
        ) : null}

        <Stars3D galaxy={galaxy} onSelectStar={onSelectStar} />

        {homeStarId != null ? (
          <HomeMarker3D galaxy={galaxy} starId={homeStarId} />
        ) : null}

        <CameraFocus target={focusTarget} distance={focusDistance} pitch={0.55} />

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          enablePan
          panSpeed={0.6}
          rotateSpeed={0.5}
          zoomSpeed={0.9}
          minDistance={r * 0.04}
          maxDistance={r * 3.2}
          maxPolarAngle={Math.PI * 0.49}
          minPolarAngle={Math.PI * 0.12}
        />
      </Canvas>

      {selectedSector ? (
        <SectorInfoPill
          sector={selectedSector}
          cluster={selectedCluster}
          galaxy={galaxy}
          onClose={() => {
            if (selectedCluster) setSelectedCluster(null);
            else setSelectedSector(null);
          }}
        />
      ) : null}
    </>
  );
}

interface PillProps {
  sector: Sector;
  cluster: Cluster | null;
  galaxy: Galaxy;
  onClose: () => void;
}

function SectorInfoPill({ sector, cluster, galaxy, onClose }: PillProps) {
  if (cluster) {
    const starCount = galaxy.stars.reduce(
      (n, s) => (s.clusterId === cluster.id ? n + 1 : n),
      0,
    );
    return (
      <div className="sector-pill">
        <div>
          <div className="sector-pill-title">{cluster.name}</div>
          <div className="sector-pill-meta">
            in {sector.name} · {cluster.groupIds.length} groups ·{" "}
            {starCount.toLocaleString()} stars
          </div>
        </div>
        <button onClick={onClose} aria-label="Close">×</button>
      </div>
    );
  }
  const clusterCount = sector.clusterIds.length;
  const starCount = galaxy.stars.reduce(
    (n, s) => (s.sectorId === sector.id ? n + 1 : n),
    0,
  );
  return (
    <div className="sector-pill">
      <div>
        <div className="sector-pill-title">{sector.name}</div>
        <div className="sector-pill-meta">
          {clusterCount} cluster{clusterCount === 1 ? "" : "s"} ·{" "}
          {starCount.toLocaleString()} star{starCount === 1 ? "" : "s"} ·{" "}
          <code>{sector.prefix}</code>
        </div>
      </div>
      <button onClick={onClose} aria-label="Close">×</button>
    </div>
  );
}
