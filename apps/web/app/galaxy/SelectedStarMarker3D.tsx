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
 * Cyan pulsing ring on the selected star. Sized in screen-constant
 * terms by rescaling every frame against camera-to-star distance, so
 * the marker never becomes a giant halo when you zoom close or a
 * vanishing dot when you zoom way out. Base geometry is 1 unit; we
 * scale it by `distance × 0.025` and add a sin pulse on top.
 */
export function SelectedStarMarker3D({ galaxy, starId }: Props) {
  const star = galaxy.stars[starId];
  const groupRef = useRef<THREE.Group>(null);
  const starPos = useRef(new THREE.Vector3());

  useFrame(({ camera, clock }) => {
    const g = groupRef.current;
    if (!g || !star) return;
    starPos.current.set(star.x, star.y, star.z);
    const dist = camera.position.distanceTo(starPos.current);
    const baseScale = Math.max(0.3, dist * 0.025);
    const pulse = 1 + Math.sin(clock.getElapsedTime() * 3.3) * 0.14;
    g.scale.setScalar(baseScale * pulse);
    g.rotation.z = clock.getElapsedTime() * -0.35;
  });

  if (!star) return null;

  // Unit-sized geometry — actual visible size driven by the useFrame
  // scaling above.
  const r1 = 1.0;
  const r2 = 1.6;

  return (
    <group ref={groupRef} position={[star.x, star.y, star.z]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r1, r1 * 0.09, 8, 48]} />
        <meshBasicMaterial
          color="#7fe6ff"
          transparent
          opacity={0.95}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r2, r2 * 0.04, 8, 48]} />
        <meshBasicMaterial
          color="#7fe6ff"
          transparent
          opacity={0.4}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
