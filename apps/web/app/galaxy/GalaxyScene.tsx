"use client";

import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { generateGalaxy, type Star } from "@space-bros/shared";
import { Stars } from "./Stars";
import { SystemView } from "./SystemView";
import { ResearchPanel } from "./ResearchPanel";
import { ResourcesHud } from "./ResourcesHud";
import { FleetsHud } from "./FleetsHud";
import { usePlayer } from "./usePlayer";
import { IS_OFFLINE, resetOfflineState } from "@/lib/api";

interface GalaxySceneProps {
  seed: string | number;
  starCount: number;
}

function parseStarFromPlanetId(planetId: string): number | null {
  const idx = planetId.indexOf(":");
  if (idx < 0) return null;
  const n = Number.parseInt(planetId.slice(0, idx), 10);
  return Number.isFinite(n) ? n : null;
}

export default function GalaxyScene({ seed, starCount }: GalaxySceneProps) {
  const galaxy = useMemo(() => generateGalaxy({ seed, starCount }), [seed, starCount]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const player = usePlayer();

  const selected = selectedId !== null ? galaxy.stars[selectedId] : undefined;
  const me = player.data;
  const hasHome = Boolean(me?.player?.homeColonyId);

  const homeStarId = me?.homeColony ? parseStarFromPlanetId(me.homeColony.planetId) : null;

  const ownedPlanetIds = useMemo(() => {
    return new Set(me?.colonies.map((c) => c.planetId) ?? []);
  }, [me]);

  const inFlightPlanetIds = useMemo(() => {
    // For v1 the colony_founded event payload lives server-side, so
    // the best we can do from the client is "there's a fleet heading
    // to this star" — good enough to stop double-launching.
    const set = new Set<string>();
    if (!me) return set;
    for (const f of me.fleets) {
      for (const planet of galaxy.stars[f.toStarId]?.planets ?? []) {
        set.add(`${f.toStarId}:${planet.index}`);
      }
    }
    return set;
  }, [me, galaxy]);

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
        <h1>
          Space Bros
          {IS_OFFLINE ? <span className="offline-badge">offline</span> : null}
        </h1>
        <p className="muted">
          {galaxy.stars.length.toLocaleString()} stars · seed{" "}
          <code>{String(galaxy.seed)}</code>
        </p>
        {me ? (
          <p className="muted">
            {me.player.displayName}
            {me.player.isDevUser ? <span className="dev-badge">dev</span> : null}
            {" · "}
            {hasHome ? `${me.colonies.length} ${me.colonies.length === 1 ? "colony" : "colonies"}` : "pick a home planet"}
          </p>
        ) : player.loading ? (
          <p className="muted">loading player…</p>
        ) : player.error ? (
          <p className="error">{player.error.message ?? player.error.error}</p>
        ) : null}
        {me ? <ResourcesHud me={me} /> : null}
        <p className="muted hint">
          Drag to orbit · pinch / scroll to zoom · tap a star
        </p>
        {IS_OFFLINE ? (
          <button
            className="reset-btn"
            onClick={() => {
              if (window.confirm("Wipe offline save and start over?")) {
                resetOfflineState();
                window.location.reload();
              }
            }}
          >
            Reset offline save
          </button>
        ) : null}
      </header>

      {me && hasHome ? <ResearchPanel me={me} startResearch={player.startResearch} /> : null}
      {me ? <FleetsHud me={me} /> : null}

      {selected ? (
        <SystemView
          star={selected}
          onClose={() => setSelectedId(null)}
          canPickHome={me != null && !hasHome}
          pickHome={player.pickHome}
          launchColony={player.launchColony}
          hasHome={hasHome}
          homeStarId={homeStarId}
          ownedPlanetIds={ownedPlanetIds}
          inFlightPlanetIds={inFlightPlanetIds}
        />
      ) : null}
    </div>
  );
}
