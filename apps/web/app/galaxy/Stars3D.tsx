"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { Galaxy, Star } from "@space-bros/shared";
import { SPECTRAL_POINT_SIZE, SPECTRAL_RGB } from "./palette";

interface Props {
  galaxy: Galaxy;
  onSelectStar: (star: Star) => void;
}

/**
 * Instanced `THREE.Points` for every star in the galaxy. Uses a custom
 * ShaderMaterial so we can:
 *   - Attenuate size with distance (stars feel real when you zoom in)
 *   - Clamp minimum pixel size so distant stars don't subpixel out
 *   - Additive-blended soft disc so they glow without baked textures
 *   - Per-star size driven by spectral class
 *
 * Raycasting uses the default Points threshold; `onPointerDown` returns
 * an `event.index` which we map back to the star list.
 */
export function Stars3D({ galaxy, onSelectStar }: Props) {
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
      const rgb = SPECTRAL_RGB[s.spectralClass];
      colors[i * 3 + 0] = rgb[0];
      colors[i * 3 + 1] = rgb[1];
      colors[i * 3 + 2] = rgb[2];
      sizes[i] = SPECTRAL_POINT_SIZE[s.spectralClass];
    }
    return { positions, colors, sizes };
  }, [galaxy]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
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
          // Size in world units projected to screen pixels with a
          // perspective term, clamped so we never go sub-pixel.
          float s = size * 360.0 * uPixelRatio / -mv.z;
          gl_PointSize = clamp(s, 2.5, 80.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float r = length(c);
          // Hot bright core + wider halo.
          float core = smoothstep(0.30, 0.00, r);
          float halo = smoothstep(0.50, 0.08, r) * 0.55;
          float a = core + halo;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * (0.7 + core * 0.6), a);
        }
      `,
    });
  }, []);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.index == null) return;
    const star = galaxy.stars[e.index];
    if (star) {
      e.stopPropagation();
      onSelectStar(star);
    }
  };

  return (
    <points onPointerDown={handlePointerDown}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <primitive object={material} attach="material" />
    </points>
  );
}
