"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { Cluster, Galaxy, Group } from "@space-bros/shared";
import { SECTOR_COLORS } from "./palette";

interface Props {
  galaxy: Galaxy;
  cluster: Cluster;
  hoveredGroupId: string | null;
  selectedGroupId: string | null;
  onHoverGroup: (group: Group | null) => void;
  onSelectGroup: (group: Group) => void;
  groupEdges: Float32Array | undefined;
  /** If false, groups render visually but ignore hover/click events. */
  active: boolean;
}

/**
 * Renders the groups inside a selected cluster as clickable sub-
 * territories. Groups are the finest hierarchy unit — each one is a
 * single Voronoi cell around ~12 stars.
 */
export function Groups3D({
  galaxy,
  cluster,
  hoveredGroupId,
  selectedGroupId,
  onHoverGroup,
  onSelectGroup,
  groupEdges,
  active,
}: Props) {
  const sectorIdx = galaxy.sectors.findIndex((s) => s.id === cluster.sectorId);
  const baseColor = SECTOR_COLORS[sectorIdx % SECTOR_COLORS.length]!;

  const groupsInCluster = useMemo(
    () =>
      galaxy.groups.filter(
        (g) => g.clusterId === cluster.id && g.polygon && g.polygon.length >= 3,
      ),
    [galaxy, cluster],
  );

  const groupMeshes = useMemo(() => {
    const base = new THREE.Color(baseColor);
    return groupsInCluster.map((group, gi) => {
      const tint = base.clone().lerp(
        gi % 2 === 0 ? new THREE.Color(1, 1, 1) : new THREE.Color(0, 0, 0),
        0.28 + (gi % 5) * 0.04,
      );
      const poly = group.polygon!;

      const shape = new THREE.Shape();
      shape.moveTo(poly[0]![0]!, poly[0]![1]!);
      for (let i = 1; i < poly.length; i++) {
        shape.lineTo(poly[i]![0]!, poly[i]![1]!);
      }
      shape.closePath();

      const geom = new THREE.ShapeGeometry(shape);
      const posAttr = geom.attributes.position;
      const idx = geom.index;
      const positions: number[] = [];
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

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      return { group, color: `#${tint.getHexString()}`, geometry };
    });
  }, [groupsInCluster, baseColor]);

  const groupEdgeGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    if (groupEdges && groupEdges.length > 0) {
      g.setAttribute("position", new THREE.Float32BufferAttribute(groupEdges, 3));
    }
    return g;
  }, [groupEdges]);

  return (
    <group position={[0, 0, 0]}>
      {groupMeshes.map(({ group, color, geometry }) => {
        const isHover = active && hoveredGroupId === group.id;
        const isSelected = selectedGroupId === group.id;
        const opacity = isSelected ? 0.6 : isHover ? 0.42 : 0.22;
        return (
          <mesh
            key={group.id}
            geometry={geometry}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => {
              if (!active) return;
              e.stopPropagation();
              onHoverGroup(group);
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={(e: ThreeEvent<PointerEvent>) => {
              if (!active) return;
              e.stopPropagation();
              onHoverGroup(null);
              document.body.style.cursor = "";
            }}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              if (!active) return;
              e.stopPropagation();
              onSelectGroup(group);
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

      <lineSegments geometry={groupEdgeGeometry} position={[0, 0.06, 0]}>
        <lineBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.5}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}
