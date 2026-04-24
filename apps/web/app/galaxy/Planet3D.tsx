"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { Planet } from "@space-bros/shared";
import {
  BIOME_PALETTE,
  makeAtmosphereMaterial,
  makeCloudsMaterial,
  makePlanetMaterial,
} from "./planetShaders";

interface Props {
  planet: Planet;
  orbitRadius: number;
  sunWorldPos: THREE.Vector3;
  size: number;
  isHover: boolean;
  isSelected: boolean;
  onHover: (planet: Planet | null) => void;
  onClick: (planet: Planet) => void;
}

/**
 * One procedurally-shaded planet: surface + optional clouds + atmosphere
 * shell. Orbits the origin of its parent group (the solar system sits at
 * the star's world position; this component's `<group>` handles orbit).
 *
 * Uniforms that depend on time or the star's world position are pushed
 * each frame from a single useFrame so every planet shares one RAF tick.
 */
export function Planet3D({
  planet,
  orbitRadius,
  sunWorldPos,
  size,
  isHover,
  isSelected,
  onHover,
  onClick,
}: Props) {
  const palette = BIOME_PALETTE[planet.biome];
  const groupRef = useRef<THREE.Group>(null);
  const surfaceMat = useMemo(() => makePlanetMaterial(planet.biome), [planet.biome]);
  const atmoMat = useMemo(() => makeAtmosphereMaterial(planet.biome), [planet.biome]);
  const cloudsMat = useMemo(
    () => (palette.clouds ? makeCloudsMaterial() : null),
    [palette.clouds],
  );

  // Dispose custom materials on unmount so hot-reload / re-renders don't
  // pile up GL resources.
  useEffect(() => {
    return () => {
      surfaceMat.dispose();
      atmoMat.dispose();
      cloudsMat?.dispose();
    };
  }, [surfaceMat, atmoMat, cloudsMat]);

  // Kepler-ish orbital speed (ω ∝ a^-1), capped.
  const speed = Math.min(0.45, 0.55 / Math.max(0.3, planet.orbitAu));
  const phase = planet.index * 1.3;

  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    const t = clock.getElapsedTime() * speed + phase;
    g.position.x = Math.cos(t) * orbitRadius;
    g.position.z = Math.sin(t) * orbitRadius;
    g.position.y = 0;
    // Slow self-rotation so the surface noise doesn't look frozen.
    g.rotation.y += 0.004;

    // Update shader uniforms with the star position (world-space so
    // the directional lighting tracks the sun even as planets move).
    const lightPos = surfaceMat.uniforms.uLightPos;
    if (lightPos) lightPos.value = sunWorldPos;
    if (cloudsMat) {
      const cTime = cloudsMat.uniforms.uTime;
      const cLight = cloudsMat.uniforms.uLightPos;
      if (cTime) cTime.value = clock.getElapsedTime();
      if (cLight) cLight.value = sunWorldPos;
    }
  });

  const highlightScale = isSelected ? 1.15 : isHover ? 1.08 : 1;

  return (
    <group ref={groupRef}>
      <mesh scale={highlightScale}>
        <sphereGeometry args={[size, 48, 32]} />
        <primitive object={surfaceMat} attach="material" />
      </mesh>

      {cloudsMat ? (
        <mesh scale={highlightScale}>
          <sphereGeometry args={[size * 1.02, 32, 20]} />
          <primitive object={cloudsMat} attach="material" />
        </mesh>
      ) : null}

      <mesh scale={highlightScale}>
        <sphereGeometry args={[size * 1.08, 32, 20]} />
        <primitive object={atmoMat} attach="material" />
      </mesh>

      {/* Invisible slightly-larger hit mesh so grazing clicks still register. */}
      <mesh
        scale={highlightScale}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onHover(planet);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onHover(null);
          document.body.style.cursor = "";
        }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onClick(planet);
        }}
      >
        <sphereGeometry args={[size * 1.15, 20, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
