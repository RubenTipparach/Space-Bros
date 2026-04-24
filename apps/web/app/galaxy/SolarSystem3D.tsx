"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { Planet, Star } from "@space-bros/shared";
import { BIOME_COLORS, SPECTRAL_RGB } from "./palette";

interface Props {
  star: Star;
  onSelectPlanet: (planet: Planet) => void;
  hoveredPlanetId: string | null;
  selectedPlanetId: string | null;
  onHoverPlanet: (planet: Planet | null) => void;
}

/**
 * One star + its planets in a 3D solar system view. Scale:
 *   1 AU → AU_SCALE units (orbit radius)
 *   planet.size (0.3 – 2.5) → ~0.5 – 3.5 units (exaggerated for click)
 *   star → 1.6 units — big enough to catch the eye at zoom out, not so
 *     big it eats the innermost planet orbits.
 *
 * Orbits animate via useFrame. Each planet's phase is its index + a
 * small per-star deterministic offset so the system starts in mid-
 * motion rather than all-aligned.
 */

export const AU_SCALE = 3.0;
export const STAR_SIZE = 1.6;
export const MIN_ORBIT = 0.8 * AU_SCALE;

/** Max orbit distance in world units, for sizing the camera frame. */
export function solarSystemMaxOrbit(star: Star): number {
  let max = MIN_ORBIT;
  for (const p of star.planets) {
    const r = Math.max(MIN_ORBIT, p.orbitAu * AU_SCALE);
    if (r > max) max = r;
  }
  return max;
}

function starColor(spectral: Star["spectralClass"]): string {
  const rgb = SPECTRAL_RGB[spectral];
  const r = Math.round(rgb[0] * 255);
  const g = Math.round(rgb[1] * 255);
  const b = Math.round(rgb[2] * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

export function SolarSystem3D({
  star,
  onSelectPlanet,
  hoveredPlanetId,
  selectedPlanetId,
  onHoverPlanet,
}: Props) {
  const color = starColor(star.spectralClass);

  return (
    <group position={[star.x, star.y, star.z]}>
      {/* Star */}
      <mesh>
        <sphereGeometry args={[STAR_SIZE, 32, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* Soft corona halo */}
      <mesh>
        <sphereGeometry args={[STAR_SIZE * 2.2, 24, 12]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.12}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {star.planets.map((planet) => {
        const orbitRadius = Math.max(MIN_ORBIT, planet.orbitAu * AU_SCALE);
        return (
          <OrbitRing key={`ring-${planet.id}`} radius={orbitRadius} />
        );
      })}

      {star.planets.map((planet) => {
        const orbitRadius = Math.max(MIN_ORBIT, planet.orbitAu * AU_SCALE);
        return (
          <PlanetOrbital
            key={planet.id}
            planet={planet}
            orbitRadius={orbitRadius}
            isHover={hoveredPlanetId === planet.id}
            isSelected={selectedPlanetId === planet.id}
            onClick={onSelectPlanet}
            onHover={onHoverPlanet}
          />
        );
      })}
    </group>
  );
}

function OrbitRing({ radius }: { radius: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.04, radius + 0.04, 96]} />
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

interface PlanetOrbitalProps {
  planet: Planet;
  orbitRadius: number;
  isHover: boolean;
  isSelected: boolean;
  onClick: (planet: Planet) => void;
  onHover: (planet: Planet | null) => void;
}

function PlanetOrbital({
  planet,
  orbitRadius,
  isHover,
  isSelected,
  onClick,
  onHover,
}: PlanetOrbitalProps) {
  const ref = useRef<THREE.Mesh>(null);

  // Kepler-ish: inner planets orbit faster. T ∝ a^1.5, so ω ∝ a^-1.5.
  // Cap speed so innermost planets don't zip around absurdly fast.
  const speed = Math.min(0.45, 0.6 / Math.pow(Math.max(0.3, planet.orbitAu), 1.0));
  const phase = planet.index * 1.3;
  const size = Math.max(0.45, planet.size * 1.6);
  const color = BIOME_COLORS[planet.biome];

  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.getElapsedTime() * speed + phase;
    m.position.x = Math.cos(t) * orbitRadius;
    m.position.z = Math.sin(t) * orbitRadius;
    m.position.y = 0;
  });

  const opacity = isSelected ? 1 : isHover ? 0.95 : 0.88;

  return (
    <group>
      <mesh
        ref={ref}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onClick(planet);
        }}
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
      >
        <sphereGeometry args={[size, 24, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
