"use client";

import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { generateGalaxy, type Star } from "@space-bros/shared";
import { Stars } from "./Stars";
import { SystemView } from "./SystemView";

interface GalaxySceneProps {
  seed: string | number;
  starCount: number;
}

export default function GalaxyScene({ seed, starCount }: GalaxySceneProps) {
  const galaxy = useMemo(() => generateGalaxy({ seed, starCount }), [seed, starCount]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selected = selectedId !== null ? galaxy.stars[selectedId] : undefined;

  return (
    <div className="scene">
      <Canvas
        camera={{ position: [0, 180, 320], fov: 55, near: 0.1, far: 4000 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => gl.setClearColor("#05060a")}
      >
        <ambientLight intensity={0.4} />
        <Stars
          galaxy={galaxy}
          selectedId={selectedId}
          onSelect={(s: Star) => setSelectedId(s.id)}
        />
        <OrbitControls
          makeDefault
          enablePan
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.6}
          zoomSpeed={0.8}
          maxDistance={1200}
          minDistance={20}
        />
      </Canvas>

      <header className="hud">
        <h1>Space Bros</h1>
        <p className="muted">
          {galaxy.stars.length.toLocaleString()} stars · seed{" "}
          <code>{String(galaxy.seed)}</code>
        </p>
        <p className="muted hint">
          Drag to orbit · pinch / scroll to zoom · tap a star
        </p>
      </header>

      {selected ? (
        <SystemView star={selected} onClose={() => setSelectedId(null)} />
      ) : null}
    </div>
  );
}
