"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { Galaxy } from "@space-bros/shared";
import { SECTOR_COLORS } from "./palette";

interface Props {
  galaxy: Galaxy;
}

/**
 * Renders each sector as a flat translucent mesh on the y=0 galactic
 * plane. The sector's visible shape is the union of its member groups'
 * Voronoi cells — we avoid an expensive boolean-union step by
 * triangulating each group cell and merging the triangles into one
 * `BufferGeometry` per sector. Shared edges between adjacent groups
 * in the same sector just happen to kiss perfectly because they come
 * from the same Voronoi. Shared edges between DIFFERENT sectors show
 * up as sharp colour boundaries — which is what we want.
 *
 * Sits at `y = -0.4` so it's always below the stars without z-fighting.
 */
export function Sectors3D({ galaxy }: Props) {
  const sectorMeshes = useMemo(() => {
    const clusterById = new Map(galaxy.clusters.map((c) => [c.id, c]));
    const groupById = new Map(galaxy.groups.map((g) => [g.id, g]));

    return galaxy.sectors.map((sector, si) => {
      const color = SECTOR_COLORS[si % SECTOR_COLORS.length]!;
      const positions: number[] = [];

      for (const clusterId of sector.clusterIds) {
        const cluster = clusterById.get(clusterId);
        if (!cluster) continue;
        for (const groupId of cluster.groupIds) {
          const group = groupById.get(groupId);
          if (!group?.polygon || group.polygon.length < 3) continue;

          // Build a THREE.Shape from the (x, z) polygon. Three's
          // ShapeGeometry treats those as (x, y) and earcut-triangulates;
          // we then map each vertex to (x, 0, y) so it lies on the
          // galactic plane.
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
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.computeVertexNormals();
      return { sector, color, geometry };
    });
  }, [galaxy]);

  return (
    <group position={[0, -0.4, 0]}>
      {sectorMeshes.map(({ sector, color, geometry }) => (
        <mesh key={sector.id} geometry={geometry}>
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.14}
            side={THREE.DoubleSide}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      ))}
    </group>
  );
}
