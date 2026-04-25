"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { Planet, Star } from "@space-bros/shared";
import { Planet3D } from "./Planet3D";
import { Sun3D } from "./Sun3D";

interface Props {
  star: Star;
  onSelectPlanet: (planet: Planet, worldPos: THREE.Vector3) => void;
  hoveredPlanetId: string | null;
  selectedPlanetId: string | null;
  onHoverPlanet: (planet: Planet | null) => void;
}

/**
 * Solar system view. Sun + orbits + per-planet procedural shader.
 *
 * Planet sizes were bumped 4× per user ask so they're easy to click
 * even with the camera framing the whole system. Min orbit bumped
 * so the inner planet doesn't overlap the sun corona. Orbit rings
 * use two layers (sharp inner + wide soft glow) so the geometry of
 * the system is readable at a glance.
 */

export const AU_SCALE = 5.0;
export const STAR_SIZE = 3.5;
export const MIN_ORBIT = 16;
const PLANET_SIZE_MIN = 4.0;
const PLANET_SIZE_BASE = 4.0;
/** Largest allowed planet radius — keeps even gas giants clear of neighbours. */
const PLANET_SIZE_MAX = 9.0;

export function solarSystemMaxOrbit(star: Star): number {
  let max = MIN_ORBIT;
  for (const p of star.planets) {
    const r = Math.max(MIN_ORBIT, p.orbitAu * AU_SCALE);
    if (r > max) max = r;
  }
  return max;
}

function planetSize(planet: Planet): number {
  return Math.min(
    PLANET_SIZE_MAX,
    Math.max(PLANET_SIZE_MIN, planet.size * PLANET_SIZE_BASE),
  );
}

export function SolarSystem3D({
  star,
  onSelectPlanet,
  hoveredPlanetId,
  selectedPlanetId,
  onHoverPlanet,
}: Props) {
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
          highlighted={selectedPlanetId === planet.id || hoveredPlanetId === planet.id}
        />
      ))}

      {star.planets.map((planet) => {
        const orbitRadius = Math.max(MIN_ORBIT, planet.orbitAu * AU_SCALE);
        const size = planetSize(planet);
        return (
          <Planet3D
            key={planet.id}
            planet={planet}
            orbitRadius={orbitRadius}
            sunWorldPos={sunWorldPos}
            size={size}
            isHover={hoveredPlanetId === planet.id}
            isSelected={selectedPlanetId === planet.id}
            orbitPaused={selectedPlanetId === planet.id}
            onHover={onHoverPlanet}
            onClick={onSelectPlanet}
          />
        );
      })}
    </group>
  );
}

function OrbitRing({ radius, highlighted }: { radius: number; highlighted: boolean }) {
  // Two rings per orbit: a crisp bright inner line + a wide soft
  // glow. Highlighted (hovered / selected planet's orbit) is more
  // saturated so the player can see which orbit they're engaging.
  const sharpColor = highlighted ? "#e6f2ff" : "#aec7ff";
  const haloColor = highlighted ? "#aec7ff" : "#6f8fc2";
  const sharpOpacity = highlighted ? 0.95 : 0.55;
  const haloOpacity = highlighted ? 0.32 : 0.14;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.12, radius + 0.12, 160]} />
        <meshBasicMaterial
          color={sharpColor}
          transparent
          opacity={sharpOpacity}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.6, radius + 0.6, 160]} />
        <meshBasicMaterial
          color={haloColor}
          transparent
          opacity={haloOpacity}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
