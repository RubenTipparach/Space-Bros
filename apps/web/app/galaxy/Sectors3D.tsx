"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { Galaxy, Sector } from "@space-bros/shared";
import { SECTOR_COLORS } from "./palette";

interface Props {
  galaxy: Galaxy;
  hoveredSectorId: string | null;
  selectedSectorId: string | null;
  onHoverSector: (sector: Sector | null) => void;
  onSelectSector: (sector: Sector) => void;
  sectorEdges: Float32Array;
  rimEdges: Float32Array;
  /** If false, fills still render but hover/click are disabled. */
  active: boolean;
}

interface SectorMeshData {
  sector: Sector;
  color: string;
  geometry: THREE.BufferGeometry;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export function Sectors3D({
  galaxy,
  hoveredSectorId,
  selectedSectorId,
  onHoverSector,
  onSelectSector,
  sectorEdges,
  rimEdges,
  active,
}: Props) {
  const sectorMeshes = useMemo<SectorMeshData[]>(() => {
    const clusterById = new Map(galaxy.clusters.map((c) => [c.id, c]));
    const groupById = new Map(galaxy.groups.map((g) => [g.id, g]));

    return galaxy.sectors.map((sector, si) => {
      const color = SECTOR_COLORS[si % SECTOR_COLORS.length]!;
      const positions: number[] = [];
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;

      for (const clusterId of sector.clusterIds) {
        const cluster = clusterById.get(clusterId);
        if (!cluster) continue;
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
              const x = posAttr!.getX(v);
              const z = posAttr!.getY(v);
              positions.push(x, 0, z);
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (z < minZ) minZ = z;
              if (z > maxZ) maxZ = z;
            }
          } else {
            for (let i = 0; i < posAttr!.count; i++) {
              const x = posAttr!.getX(i);
              const z = posAttr!.getY(i);
              positions.push(x, 0, z);
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (z < minZ) minZ = z;
              if (z > maxZ) maxZ = z;
            }
          }
          geom.dispose();
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.computeVertexNormals();
      return {
        sector,
        color,
        geometry,
        bounds: {
          minX: Number.isFinite(minX) ? minX : 0,
          minZ: Number.isFinite(minZ) ? minZ : 0,
          maxX: Number.isFinite(maxX) ? maxX : 0,
          maxZ: Number.isFinite(maxZ) ? maxZ : 0,
        },
      };
    });
  }, [galaxy]);

  const sectorEdgeGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(sectorEdges, 3));
    return g;
  }, [sectorEdges]);

  const rimEdgeGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(rimEdges, 3));
    return g;
  }, [rimEdges]);

  return (
    <group position={[0, -0.4, 0]}>
      {sectorMeshes.map(({ sector, color, geometry }) => {
        const isHover = active && hoveredSectorId === sector.id;
        const isSelected = selectedSectorId === sector.id;
        const opacity = isSelected ? 0.06 : isHover ? 0.26 : 0.16;
        return (
          <mesh
            key={sector.id}
            geometry={geometry}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => {
              if (!active) return;
              e.stopPropagation();
              onHoverSector(sector);
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={(e: ThreeEvent<PointerEvent>) => {
              if (!active) return;
              e.stopPropagation();
              onHoverSector(null);
              document.body.style.cursor = "";
            }}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              if (!active) return;
              e.stopPropagation();
              onSelectSector(sector);
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

      {/* Sector borders: bright white lines between different-sector cells. */}
      <lineSegments geometry={sectorEdgeGeometry} position={[0, 0.05, 0]}>
        <lineBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.8}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>

      {/* Galaxy rim — the clipped outer edge of the disc. */}
      <lineSegments geometry={rimEdgeGeometry} position={[0, 0.04, 0]}>
        <lineBasicMaterial
          color="#8ab4ff"
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}

export type { SectorMeshData };

export function computeSectorBounds(galaxy: Galaxy): Map<string, SectorMeshData["bounds"]> {
  const clusterById = new Map(galaxy.clusters.map((c) => [c.id, c]));
  const groupById = new Map(galaxy.groups.map((g) => [g.id, g]));
  const out = new Map<string, SectorMeshData["bounds"]>();
  for (const sector of galaxy.sectors) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const clusterId of sector.clusterIds) {
      const cluster = clusterById.get(clusterId);
      if (!cluster) continue;
      for (const groupId of cluster.groupIds) {
        const g = groupById.get(groupId);
        if (!g?.polygon) continue;
        for (const [x, z] of g.polygon) {
          if (x! < minX) minX = x!;
          if (x! > maxX) maxX = x!;
          if (z! < minZ) minZ = z!;
          if (z! > maxZ) maxZ = z!;
        }
      }
    }
    out.set(sector.id, {
      minX: Number.isFinite(minX) ? minX : 0,
      minZ: Number.isFinite(minZ) ? minZ : 0,
      maxX: Number.isFinite(maxX) ? maxX : 0,
      maxZ: Number.isFinite(maxZ) ? maxZ : 0,
    });
  }
  return out;
}
