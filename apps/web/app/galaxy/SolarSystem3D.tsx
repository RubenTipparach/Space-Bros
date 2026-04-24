"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { Planet, Star } from "@space-bros/shared";
import { Planet3D } from "./Planet3D";
import { Sun3D } from "./Sun3D";

interface Props {
  star: Star;
  onSelectPlanet: (planet: Planet) => void;
  hoveredPlanetId: string | null;
  selectedPlanetId: string | null;
  onHoverPlanet: (planet: Planet | null) => void;
}

/**
 * One star + its planets as a real 3D solar system. Everything is
 * procedurally shaded in GLSL (no textures) so it works with just the
 * static site build. Planets come out per-biome: each has a surface
 * shader, optional cloud layer, and an additive Fresnel atmosphere
 * shell.
 *
 * Scale: 1 AU → AU_SCALE world units. MIN_ORBIT keeps the innermost
 * planet clear of the sun. `solarSystemMaxOrbit` is used by the
 * camera framer so wide systems aren't cropped.
 */

export const AU_SCALE = 3.2;
export const STAR_SIZE = 1.8;
export const MIN_ORBIT = 0.9 * AU_SCALE;
const PLANET_SIZE_MIN = 0.42;
const PLANET_SIZE_SCALE = 0.28;

export function solarSystemMaxOrbit(star: Star): number {
  let max = MIN_ORBIT;
  for (const p of star.planets) {
    const r = Math.max(MIN_ORBIT, p.orbitAu * AU_SCALE);
    if (r > max) max = r;
  }
  return max;
}

export function SolarSystem3D({
  star,
  onSelectPlanet,
  hoveredPlanetId,
  selectedPlanetId,
  onHoverPlanet,
}: Props) {
  // The solar-system group sits at the star's galactic-plane position.
  // The star itself is at local origin; `sunWorldPos` = the group's
  // world translation so planet shaders can compute real light-dir.
  const sunWorldPos = useMemo(
    () => new THREE.Vector3(star.x, star.y, star.z),
    [star.x, star.y, star.z],
  );

  return (
    <group position={[star.x, star.y, star.z]}>
      <Sun3D star={star} radius={STAR_SIZE} />

      {star.planets.map((planet) => (
        <OrbitRing
          key={`ring-${planet.id}`}
          radius={Math.max(MIN_ORBIT, planet.orbitAu * AU_SCALE)}
        />
      ))}

      {star.planets.map((planet) => {
        const orbitRadius = Math.max(MIN_ORBIT, planet.orbitAu * AU_SCALE);
        const size = Math.max(
          PLANET_SIZE_MIN,
          planet.size * PLANET_SIZE_SCALE * 1.6,
        );
        return (
          <Planet3D
            key={planet.id}
            planet={planet}
            orbitRadius={orbitRadius}
            sunWorldPos={sunWorldPos}
            size={size}
            isHover={hoveredPlanetId === planet.id}
            isSelected={selectedPlanetId === planet.id}
            onHover={onHoverPlanet}
            onClick={onSelectPlanet}
          />
        );
      })}
    </group>
  );
}

function OrbitRing({ radius }: { radius: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.03, radius + 0.03, 96]} />
      <meshBasicMaterial
        color="#8ab4ff"
        transparent
        opacity={0.18}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
