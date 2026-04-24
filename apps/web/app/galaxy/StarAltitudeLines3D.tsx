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
}

/**
 * Drops a thin vertical line from y=0 (galactic plane) up to each
 * star's position. Lets the eye read stellar altitude at sector,
 * cluster, or group zoom. Looks like the reference strategy-map
 * ship-altitude indicator — same visual vocabulary.
 *
 * Rendered as a single `LineSegments` with one segment per star so
 * we stay at one draw call regardless of input size.
 */
export function StarAltitudeLines3D({
  galaxy,
  starIds,
  color = "#7fbfff",
  opacity = 0.35,
}: Props) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    for (const star of galaxy.stars) {
      if (!starIds.has(star.id)) continue;
      // From the plane up to the star. We leave the star rendering to
      // Stars3D so these lines just visually tether them.
      positions.push(star.x, 0, star.z);
      positions.push(star.x, star.y, star.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, [galaxy, starIds]);

  if (starIds.size === 0) return null;

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}
