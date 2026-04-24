"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { Galaxy } from "@space-bros/shared";

interface Props {
  galaxy: Galaxy;
  /** Filter: only draw altitude lines for stars whose ids are here. */
  starIds: ReadonlySet<number>;
  color?: string;
  opacity?: number;
  /** Radius (galaxy units) of the base disc at y = 0. */
  discRadius?: number;
}

/**
 * Drops a thin vertical line from y=0 (galactic plane) up to each
 * star's position, PLUS a small flat disc at the base of that line
 * on the plane. The disc anchors the star visually to its (x, z)
 * position — the same vocabulary as a strategy-map ship altitude
 * indicator.
 *
 * Two merged `BufferGeometry`s + one line + one mesh, regardless of
 * how many stars are active.
 */
export function StarAltitudeLines3D({
  galaxy,
  starIds,
  color = "#7fbfff",
  opacity = 0.4,
  discRadius = 0.9,
}: Props) {
  const { lineGeometry, discGeometry } = useMemo(() => {
    const linePositions: number[] = [];
    const discPositions: number[] = [];
    const segments = 14;
    for (const star of galaxy.stars) {
      if (!starIds.has(star.id)) continue;
      // altitude line
      linePositions.push(star.x, 0, star.z);
      linePositions.push(star.x, star.y, star.z);
      // base disc triangles (fan)
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const b = ((i + 1) / segments) * Math.PI * 2;
        discPositions.push(star.x, 0, star.z);
        discPositions.push(
          star.x + Math.cos(a) * discRadius,
          0,
          star.z + Math.sin(a) * discRadius,
        );
        discPositions.push(
          star.x + Math.cos(b) * discRadius,
          0,
          star.z + Math.sin(b) * discRadius,
        );
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(linePositions, 3),
    );
    const dg = new THREE.BufferGeometry();
    dg.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(discPositions, 3),
    );
    return { lineGeometry: lg, discGeometry: dg };
  }, [galaxy, starIds, discRadius]);

  if (starIds.size === 0) return null;

  return (
    <group>
      <lineSegments geometry={lineGeometry}>
        <lineBasicMaterial
          color={color}
          transparent
          opacity={opacity}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      <mesh geometry={discGeometry} position={[0, 0.01, 0]}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={Math.min(1, opacity * 1.3)}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
