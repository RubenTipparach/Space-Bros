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
  /** Freezes the orbit update when true — used while the planet is focused. */
  orbitPaused: boolean;
  onHover: (planet: Planet | null) => void;
  onClick: (planet: Planet, worldPos: THREE.Vector3) => void;
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
  orbitPaused,
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

  // Accumulated orbit angle so pausing doesn't snap the planet back
  // to t=0 when resumed — we just stop advancing it.
  const orbitT = useRef(phase);

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const { clock } = state;
    const dt = Math.min(0.1, delta);
    if (!orbitPaused) {
      orbitT.current += dt * speed;
    }
    const t = orbitT.current;
    g.position.x = Math.cos(t) * orbitRadius;
    g.position.z = Math.sin(t) * orbitRadius;
    g.position.y = 0;
    g.rotation.y += 0.004;

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

      {/* Invisible wider hit mesh so grazing clicks still register.
          Sized very generously (2.5×) since planets sit on a huge
          background plane — if the click misses the planet it lands
          on the background and previously popped the solar-system
          view. Scene3D now ignores background clicks while in solar,
          but a bigger hit area still makes selection feel responsive. */}
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
          // Grab the planet's current world position so the caller
          // can frame the camera on it — planets orbit so a later
          // lookup would point at the wrong place.
          const worldPos = new THREE.Vector3();
          (e.object as THREE.Object3D).getWorldPosition(worldPos);
          onClick(planet, worldPos);
        }}
      >
        <sphereGeometry args={[size * 2.5, 20, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
