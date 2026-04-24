"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Galaxy } from "@space-bros/shared";

interface Props {
  galaxy: Galaxy;
  starId: number;
}

/**
 * Cyan pulsing marker for the currently-selected star. Distinct colour
 * from the home marker (gold) so they're easy to tell apart when both
 * are on screen.
 */
export function SelectedStarMarker3D({ galaxy, starId }: Props) {
  const star = galaxy.stars[starId];
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    g.scale.setScalar(1 + Math.sin(t * 3.3) * 0.14);
    g.rotation.z = t * -0.35;
  });

  if (!star) return null;
  const r1 = galaxy.radius * 0.009;
  const r2 = r1 * 1.9;

  return (
    <group ref={groupRef} position={[star.x, star.y, star.z]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r1, r1 * 0.09, 8, 48]} />
        <meshBasicMaterial color="#7fe6ff" transparent opacity={0.95} toneMapped={false} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r2, r2 * 0.04, 8, 48]} />
        <meshBasicMaterial color="#7fe6ff" transparent opacity={0.45} toneMapped={false} />
      </mesh>
    </group>
  );
}
