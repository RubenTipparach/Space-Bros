"use client";

import type { Cluster, Sector } from "@space-bros/shared";

interface Props {
  sector: Sector | null;
  cluster: Cluster | null;
  onGoGalaxy: () => void;
  onGoSector: () => void;
}

export function Breadcrumb({ sector, cluster, onGoGalaxy, onGoSector }: Props) {
  return (
    <nav className="breadcrumb" aria-label="Map navigation">
      <button onClick={onGoGalaxy} className={sector ? "bc-link" : "bc-current"}>
        Galaxy
      </button>
      {sector ? (
        <>
          <span className="bc-sep">›</span>
          <button
            onClick={onGoSector}
            className={cluster ? "bc-link" : "bc-current"}
            disabled={!cluster}
          >
            {sector.name}
          </button>
        </>
      ) : null}
      {cluster ? (
        <>
          <span className="bc-sep">›</span>
          <span className="bc-current">{cluster.name}</span>
        </>
      ) : null}
    </nav>
  );
}
