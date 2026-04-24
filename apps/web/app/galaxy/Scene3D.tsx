"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Galaxy, Star } from "@space-bros/shared";
import { HomeMarker3D } from "./HomeMarker3D";
import { Stars3D } from "./Stars3D";

interface Props {
  galaxy: Galaxy;
  onSelectStar: (star: Star) => void;
  homeStarId?: number | null;
}

/**
 * Top-level 3D scene. Camera starts looking down at the galaxy from a
 * ~55° pitch, orbits with damping for smooth rotation + zoom. Zoom is a
 * real camera move — no CSS scale in sight.
 *
 * Sector / cluster borders are deliberately absent in V-2.0 — per user
 * direction they're being rewritten bottom-up (Voronoi + k-means) in
 * V-2.1. The data model in `galaxy.sectors` / `galaxy.clusters` still
 * tags stars but nothing draws the territory shapes yet.
 */
export function Scene3D({ galaxy, onSelectStar, homeStarId }: Props) {
  const r = galaxy.radius;
  return (
    <Canvas
      className="scene-canvas"
      camera={{
        position: [0, r * 0.9, r * 1.35],
        fov: 55,
        near: r * 0.01,
        far: r * 12,
      }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
      }}
    >
      <ambientLight intensity={0.4} />

      <Stars3D galaxy={galaxy} onSelectStar={onSelectStar} />

      {homeStarId != null ? (
        <HomeMarker3D galaxy={galaxy} starId={homeStarId} />
      ) : null}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan
        panSpeed={0.6}
        rotateSpeed={0.5}
        zoomSpeed={0.9}
        minDistance={r * 0.12}
        maxDistance={r * 3.2}
        maxPolarAngle={Math.PI * 0.49}
        minPolarAngle={Math.PI * 0.12}
      />
    </Canvas>
  );
}
