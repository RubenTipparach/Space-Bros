import { pick, rangeFloat, rangeInt, rngFromSeed } from "./rng.ts";
import type { Sector } from "./sectors.ts";
import { CORE_INNER_RADIUS_FRACTION } from "./sectors.ts";

/**
 * Clusters: spatial clumps of stars within a sector, named and
 * grid-coded. Per ADR-019.
 *
 * ~3–4 clusters per outer sector, 2 in the Core ≈ 20 total.
 * Each cluster has:
 *   - short code: `${sectorPrefix}-${gridCell}-${fancyName}`
 *     e.g. "ORN-B3-Kestrel"
 *   - display name: `${fancyName} Cluster (${sectorPrefix}-${gridCell})`
 *     e.g. "Kestrel Cluster (ORN-B3)"
 *
 * Grid: 5 angular sub-wedges (A..E) × 5 radial bands (1..5). Outer
 * sectors subdivide their 60° wedge into those 25 cells; Core uses
 * its own r-only grid (bands 1..5) with a single letter "C".
 */

const FANCY_NAMES = [
  "Kestrel", "Orpheus", "Maelstrom", "Halcyon", "Prometheus", "Icarus",
  "Sable", "Zephyr", "Solstice", "Vortex", "Nimbus", "Hyperion",
  "Tethys", "Thule", "Pandora", "Argus", "Basilisk", "Tempest",
  "Echo", "Obsidian", "Mirage", "Chimera", "Vagrant", "Zenith",
  "Harbinger", "Rook", "Pale", "Wraith",
] as const;

export interface ClusterGridCell {
  /** "A".."E" for outer sectors, "C" for Core. */
  letter: string;
  /** 1..5 radial band. */
  band: number;
}

export interface Cluster {
  id: string;                    // stable, e.g. "cls_ORN_B3"
  sectorId: string;
  name: string;                  // display: "Kestrel Cluster (ORN-B3)"
  prefix: string;                // sector prefix, e.g. "ORN"
  code: string;                  // "ORN-B3" short code
  grid: ClusterGridCell;
  /** Center position in galactic plane, scaled by galaxy.radius. */
  center: { x: number; y: number; z: number };
  /** Approximate radius within which stars belong. */
  spread: number;
}

/**
 * Counts land us on exactly 20 clusters for a 7-sector galaxy
 * (2 Core + 3 × 6 outer). The user's ask was 15-20; we hold at 20
 * for consistency so a grid code like `ORN-C3` always refers to the
 * same cell type across games.
 */
const DEFAULT_COUNTS: Record<Sector["kind"], number> = {
  core: 2,
  outer: 3,
};

export interface GenerateClustersOptions {
  seed: number | string;
  sectors: Sector[];
  /** Absolute galaxy radius (ly). */
  galaxyRadius: number;
}

export function generateClusters(opts: GenerateClustersOptions): Cluster[] {
  const { seed, sectors, galaxyRadius } = opts;
  const rng = rngFromSeed(`${seed}:clusters`);
  const clusters: Cluster[] = [];

  for (const sector of sectors) {
    const count = DEFAULT_COUNTS[sector.kind];

    for (let i = 0; i < count; i++) {
      const fancy = pick(rng, FANCY_NAMES);
      const grid = sampleGridCell(rng, sector);
      const code = `${sector.prefix}-${grid.letter}${grid.band}`;
      const id = `cls_${sector.prefix}_${grid.letter}${grid.band}_${i}`;
      const center = gridCellCenter(sector, grid, galaxyRadius);
      // Nudge the center a little within the cell so two clusters in
      // the same cell (rare) aren't stacked.
      const jitter = galaxyRadius * 0.02;
      center.x += rangeFloat(rng, -jitter, jitter);
      center.z += rangeFloat(rng, -jitter, jitter);

      clusters.push({
        id,
        sectorId: sector.id,
        name: `${fancy} Cluster (${code})`,
        prefix: sector.prefix,
        code,
        grid,
        center,
        spread: galaxyRadius * rangeFloat(rng, 0.025, 0.06),
      });
    }
  }

  return clusters;
}

const OUTER_LETTERS = ["A", "B", "C", "D", "E"] as const;

function sampleGridCell(
  rng: ReturnType<typeof rngFromSeed>,
  sector: Sector,
): ClusterGridCell {
  const band = rangeInt(rng, 1, 5);
  if (sector.kind === "core") {
    return { letter: "C", band };
  }
  return { letter: OUTER_LETTERS[rangeInt(rng, 0, 4)]!, band };
}

/**
 * Geometric center of a cluster grid cell in world coordinates.
 * Returns an (x, y, z) with y = 0 (galactic plane); a little vertical
 * jitter is added when the cluster actually produces star positions.
 */
function gridCellCenter(
  sector: Sector,
  grid: ClusterGridCell,
  galaxyRadius: number,
): { x: number; y: number; z: number } {
  if (sector.kind === "core") {
    // Core grid: 5 concentric bands between r=0 and r=coreInner.
    const coreRadius = galaxyRadius * CORE_INNER_RADIUS_FRACTION;
    const bandCenter = ((grid.band - 0.5) / 5) * coreRadius;
    // Spread Core clusters evenly in angle based on band number.
    const angle = ((grid.band - 1) / 5) * Math.PI * 2;
    return {
      x: Math.cos(angle) * bandCenter,
      y: 0,
      z: Math.sin(angle) * bandCenter,
    };
  }

  // Outer grid: 5 angular sub-wedges × 5 radial bands.
  const wedge = sector.wedge!;
  const totalWedge = wedgeLength(wedge);
  const letterIdx = OUTER_LETTERS.indexOf(grid.letter as typeof OUTER_LETTERS[number]);
  const angle = wedge.start + ((letterIdx + 0.5) / OUTER_LETTERS.length) * totalWedge;

  const rInner = galaxyRadius * CORE_INNER_RADIUS_FRACTION;
  const rOuter = galaxyRadius;
  const rCenter = rInner + ((grid.band - 0.5) / 5) * (rOuter - rInner);

  return {
    x: Math.cos(angle) * rCenter,
    y: 0,
    z: Math.sin(angle) * rCenter,
  };
}

function wedgeLength(w: { start: number; end: number }): number {
  const TWO_PI = Math.PI * 2;
  const raw = w.end - w.start;
  return raw >= 0 ? raw : raw + TWO_PI;
}

/**
 * Find the nearest cluster to a star's (x, z) position within its
 * sector. Ties broken by array order.
 */
export function classifyClusterForStar(
  x: number,
  z: number,
  sectorId: string,
  clusters: Cluster[],
): Cluster | null {
  let best: Cluster | null = null;
  let bestDist = Infinity;
  for (const c of clusters) {
    if (c.sectorId !== sectorId) continue;
    const dx = c.center.x - x;
    const dz = c.center.z - z;
    const d = Math.hypot(dx, dz);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}
