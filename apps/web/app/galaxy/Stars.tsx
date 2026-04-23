"use client";

import { useMemo } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Galaxy, Star } from "@space-bros/shared";
import { SPECTRAL_COLORS, SPECTRAL_SIZES } from "./palette";

interface StarsProps {
  galaxy: Galaxy;
  selectedId: number | null;
  onSelect: (star: Star) => void;
}

export function Stars({ galaxy, selectedId, onSelect }: StarsProps) {
  const { positions, colors, sizes } = useMemo(() => {
    const n = galaxy.stars.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = galaxy.stars[i]!;
      positions[i * 3 + 0] = s.x;
      positions[i * 3 + 1] = s.y;
      positions[i * 3 + 2] = s.z;
      const rgb = SPECTRAL_COLORS[s.spectralClass];
      colors[i * 3 + 0] = rgb[0];
      colors[i * 3 + 1] = rgb[1];
      colors[i * 3 + 2] = rgb[2];
      sizes[i] = SPECTRAL_SIZES[s.spectralClass];
    }
    return { positions, colors, sizes };
  }, [galaxy]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: {
          value: typeof window !== "undefined" ? window.devicePixelRatio : 1,
        },
      },
      vertexShader: /* glsl */ `
        attribute float size;
        varying vec3 vColor;
        uniform float uPixelRatio;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float s = size * 180.0 * uPixelRatio / -mv.z;
          gl_PointSize = clamp(s, 1.5, 40.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float r = length(c);
          float a = smoothstep(0.5, 0.0, r);
          gl_FragColor = vec4(vColor, a);
        }
      `,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, []);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.index == null) return;
    const star = galaxy.stars[e.index];
    if (star) {
      e.stopPropagation();
      onSelect(star);
    }
  };

  return (
    <>
      <points onPointerDown={handlePointerDown}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[positions, 3]}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[colors, 3]}
          />
          <bufferAttribute
            attach="attributes-size"
            args={[sizes, 1]}
          />
        </bufferGeometry>
        <primitive object={material} attach="material" />
      </points>
      {selectedId !== null && galaxy.stars[selectedId] ? (
        <SelectionRing star={galaxy.stars[selectedId]!} />
      ) : null}
    </>
  );
}

function SelectionRing({ star }: { star: Star }) {
  return (
    <mesh position={[star.x, star.y, star.z]} rotation={[Math.PI / 2, 0, 0]}>
      <ringGeometry args={[2.5, 3.2, 48]} />
      <meshBasicMaterial
        color="#8ab4ff"
        side={THREE.DoubleSide}
        transparent
        opacity={0.85}
      />
    </mesh>
  );
}
