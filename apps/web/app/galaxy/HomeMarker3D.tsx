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
 * 3D home-star marker: two concentric rings that pulse slowly and
 * always face the camera. Rendered above the star so it's visible
 * even when the star itself is behind a dust puff.
 */
export function HomeMarker3D({ galaxy, starId }: Props) {
  const star = galaxy.stars[starId];
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    const pulse = 1 + Math.sin(t * 2.2) * 0.08;
    g.scale.setScalar(pulse);
    g.rotation.z = t * 0.25;
  });

  if (!star) return null;
  const r1 = galaxy.radius * 0.012;
  const r2 = r1 * 1.6;

  return (
    <group ref={groupRef} position={[star.x, star.y, star.z]}>
      {/* Two torus rings on the galactic plane. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r1, r1 * 0.08, 8, 48]} />
        <meshBasicMaterial
          color="#ffe26a"
          transparent
          opacity={0.95}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r2, r2 * 0.04, 8, 48]} />
        <meshBasicMaterial
          color="#ffe26a"
          transparent
          opacity={0.35}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
