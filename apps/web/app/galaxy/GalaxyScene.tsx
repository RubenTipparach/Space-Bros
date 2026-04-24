"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { generateGalaxy, type Star } from "@space-bros/shared";
import { SystemView } from "./SystemView";
import { ResearchPanel } from "./ResearchPanel";
import { ResourcesHud } from "./ResourcesHud";
import { FleetsHud } from "./FleetsHud";
import { usePlayer } from "./usePlayer";
import { IS_OFFLINE, resetOfflineState } from "@/lib/api";

// Three.js needs to run in the browser — lazy import with SSR off.
const Scene3D = dynamic(() => import("./Scene3D").then((m) => m.Scene3D), {
  ssr: false,
  loading: () => <div className="loading">Warming up the galaxy…</div>,
});

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
  const [selectedStar, setSelectedStar] = useState<Star | null>(null);
  const player = usePlayer();

  const me = player.data;
  const hasHome = Boolean(me?.player?.homeColonyId);

  const homeStarId = me?.homeColony ? parseStarFromPlanetId(me.homeColony.planetId) : null;

  const ownedPlanetIds = useMemo(() => {
    return new Set(me?.colonies.map((c) => c.planetId) ?? []);
  }, [me]);

  const inFlightPlanetIds = useMemo(() => {
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
      <div className="nebula-bg" aria-hidden>
        <div className="nebula-layer layer-a" />
        <div className="nebula-layer layer-b" />
        <div className="nebula-layer layer-c" />
        <div className="nebula-layer layer-d" />
        <div className="nebula-grain" />
      </div>

      <Scene3D
        galaxy={galaxy}
        onSelectStar={setSelectedStar}
        homeStarId={homeStarId}
      />

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
            {hasHome
              ? `${me.colonies.length} ${me.colonies.length === 1 ? "colony" : "colonies"}`
              : "pick a home planet"}
          </p>
        ) : player.loading ? (
          <p className="muted">loading player…</p>
        ) : player.error ? (
          <p className="error">{player.error.message ?? player.error.error}</p>
        ) : null}
        {me ? <ResourcesHud me={me} /> : null}
        <p className="muted hint">
          Drag to orbit · scroll / pinch to zoom · right-click to pan · tap a star
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

      {selectedStar ? (
        <SystemView
          star={selectedStar}
          onClose={() => setSelectedStar(null)}
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
