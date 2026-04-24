"use client";

import { useMemo, useState } from "react";
import type { Cluster, Galaxy, Sector, Star } from "@space-bros/shared";
import { Breadcrumb } from "./Breadcrumb";
import { ClusterMap } from "./ClusterMap";
import { GalaxyMap } from "./GalaxyMap";
import { NebulaBackground } from "./NebulaBackground";
import { SectorMap } from "./SectorMap";

type MapView =
  | { level: "galaxy" }
  | { level: "sector"; sectorId: string }
  | { level: "cluster"; sectorId: string; clusterId: string };

interface Props {
  galaxy: Galaxy;
  onSelectStar: (star: Star) => void;
}

export function MapRoot({ galaxy, onSelectStar }: Props) {
  const [view, setView] = useState<MapView>({ level: "galaxy" });

  const sector: Sector | null = useMemo(() => {
    if (view.level === "galaxy") return null;
    return galaxy.sectors.find((s) => s.id === view.sectorId) ?? null;
  }, [galaxy, view]);

  const cluster: Cluster | null = useMemo(() => {
    if (view.level !== "cluster") return null;
    return galaxy.clusters.find((c) => c.id === view.clusterId) ?? null;
  }, [galaxy, view]);

  return (
    <div className="map-root">
      <NebulaBackground />
      <Breadcrumb
        sector={sector}
        cluster={cluster}
        onGoGalaxy={() => setView({ level: "galaxy" })}
        onGoSector={() =>
          sector ? setView({ level: "sector", sectorId: sector.id }) : undefined
        }
      />
      <div className="map-viewport">
        {view.level === "galaxy" ? (
          <GalaxyMap
            galaxy={galaxy}
            onSelectSector={(s) => setView({ level: "sector", sectorId: s.id })}
          />
        ) : null}
        {view.level === "sector" && sector ? (
          <SectorMap
            galaxy={galaxy}
            sector={sector}
            onSelectCluster={(c) =>
              setView({ level: "cluster", sectorId: sector.id, clusterId: c.id })
            }
          />
        ) : null}
        {view.level === "cluster" && sector && cluster ? (
          <ClusterMap
            galaxy={galaxy}
            sector={sector}
            cluster={cluster}
            onSelectStar={onSelectStar}
          />
        ) : null}
      </div>
    </div>
  );
}
