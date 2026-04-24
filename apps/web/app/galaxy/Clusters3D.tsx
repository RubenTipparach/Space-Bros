"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { Cluster, Galaxy, Sector } from "@space-bros/shared";
import { SECTOR_COLORS } from "./palette";

interface Props {
  galaxy: Galaxy;
  sector: Sector;
  hoveredClusterId: string | null;
  selectedClusterId: string | null;
  onHoverCluster: (cluster: Cluster | null) => void;
  onSelectCluster: (cluster: Cluster) => void;
  /** Cluster border edges inside this sector — from borders.extractBorders. */
  clusterEdges: Float32Array | undefined;
}

interface ClusterMeshData {
  cluster: Cluster;
  color: string;
  geometry: THREE.BufferGeometry;
}

/**
 * Sub-territory view. Only mounts when a sector is selected.
 * Draws each cluster inside the sector as its own tinted mesh on the
 * galactic plane plus a line-segment overlay for cluster borders.
 *
 * Clusters share the sector's hue but with per-cluster brightness
 * variation — enough contrast to read the structure, not enough to
 * fight with the overall sector identity.
 */
export function Clusters3D({
  galaxy,
  sector,
  hoveredClusterId,
  selectedClusterId,
  onHoverCluster,
  onSelectCluster,
  clusterEdges,
}: Props) {
  const sectorIdx = galaxy.sectors.findIndex((s) => s.id === sector.id);
  const baseColor = SECTOR_COLORS[sectorIdx % SECTOR_COLORS.length]!;

  const clusterMeshes = useMemo<ClusterMeshData[]>(() => {
    const base = new THREE.Color(baseColor);
    const groupById = new Map(galaxy.groups.map((g) => [g.id, g]));
    const clustersInSector = galaxy.clusters.filter((c) => c.sectorId === sector.id);

    return clustersInSector.map((cluster, ci) => {
      // Hue-preserving tint offset per cluster so neighbours are
      // visually distinct without drifting far from the sector hue.
      const tint = base.clone().lerp(
        ci % 2 === 0 ? new THREE.Color(1, 1, 1) : new THREE.Color(0, 0, 0),
        0.18 + (ci % 4) * 0.04,
      );
      const positions: number[] = [];

      for (const groupId of cluster.groupIds) {
        const group = groupById.get(groupId);
        if (!group?.polygon || group.polygon.length < 3) continue;

        const shape = new THREE.Shape();
        shape.moveTo(group.polygon[0]![0]!, group.polygon[0]![1]!);
        for (let i = 1; i < group.polygon.length; i++) {
          shape.lineTo(group.polygon[i]![0]!, group.polygon[i]![1]!);
        }
        shape.closePath();

        const geom = new THREE.ShapeGeometry(shape);
        const posAttr = geom.attributes.position;
        const idx = geom.index;
        if (idx) {
          const arr = idx.array as ArrayLike<number>;
          for (let i = 0; i < arr.length; i++) {
            const v = arr[i]!;
            positions.push(posAttr!.getX(v), 0, posAttr!.getY(v));
          }
        } else {
          for (let i = 0; i < posAttr!.count; i++) {
            positions.push(posAttr!.getX(i), 0, posAttr!.getY(i));
          }
        }
        geom.dispose();
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.computeVertexNormals();
      return { cluster, color: `#${tint.getHexString()}`, geometry };
    });
  }, [galaxy, sector, baseColor]);

  const clusterEdgeGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    if (clusterEdges && clusterEdges.length > 0) {
      g.setAttribute("position", new THREE.Float32BufferAttribute(clusterEdges, 3));
    }
    return g;
  }, [clusterEdges]);

  return (
    <group position={[0, -0.2, 0]}>
      {clusterMeshes.map(({ cluster, color, geometry }) => {
        const isHover = hoveredClusterId === cluster.id;
        const isSelected = selectedClusterId === cluster.id;
        const opacity = isSelected ? 0.52 : isHover ? 0.42 : 0.28;
        return (
          <mesh
            key={cluster.id}
            geometry={geometry}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              onHoverCluster(cluster);
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              onHoverCluster(null);
              document.body.style.cursor = "";
            }}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              onSelectCluster(cluster);
            }}
          >
            <meshBasicMaterial
              color={color}
              transparent
              opacity={opacity}
              side={THREE.DoubleSide}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-1}
              polygonOffsetUnits={-1}
            />
          </mesh>
        );
      })}

      <lineSegments geometry={clusterEdgeGeometry} position={[0, 0.08, 0]}>
        <lineBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}
