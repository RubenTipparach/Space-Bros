"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Star } from "@space-bros/shared";
import { SPECTRAL_RGB } from "./palette";
import { makeSunMaterial } from "./planetShaders";

interface Props {
  star: Star;
  radius: number;
}

function starCssColor(spectral: Star["spectralClass"]): string {
  const rgb = SPECTRAL_RGB[spectral];
  const r = Math.round(rgb[0] * 255);
  const g = Math.round(rgb[1] * 255);
  const b = Math.round(rgb[2] * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Glowing sun: a shader-driven photosphere sphere, a tight inner
 * corona, and a wide soft halo. The photosphere uses a time-varying
 * fbm pattern so it doesn't look static on approach.
 */
export function Sun3D({ star, radius }: Props) {
  const surfaceMat = useMemo(
    () => makeSunMaterial(starCssColor(star.spectralClass)),
    [star.spectralClass],
  );
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    return () => surfaceMat.dispose();
  }, [surfaceMat]);

  useFrame(({ clock }) => {
    const uTime = surfaceMat.uniforms.uTime;
    if (uTime) uTime.value = clock.getElapsedTime();
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.04;
    }
  });

  const cssColor = starCssColor(star.spectralClass);

  return (
    <group ref={groupRef}>
      {/* Photosphere */}
      <mesh>
        <sphereGeometry args={[radius, 48, 32]} />
        <primitive object={surfaceMat} attach="material" />
      </mesh>
      {/* Inner corona — sharp glow just outside the photosphere. */}
      <mesh>
        <sphereGeometry args={[radius * 1.35, 32, 20]} />
        <meshBasicMaterial
          color={cssColor}
          transparent
          opacity={0.35}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      {/* Outer halo — soft, wide. */}
      <mesh>
        <sphereGeometry args={[radius * 2.3, 32, 20]} />
        <meshBasicMaterial
          color={cssColor}
          transparent
          opacity={0.12}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
