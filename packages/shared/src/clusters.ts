import { pick, rangeFloat, rangeInt, rngFromSeed, type Rng } from "./rng.ts";
import { CORE_INNER_RADIUS_FRACTION, wedgeLength, type Sector } from "./sectors.ts";

/**
 * Clusters: spatial clumps of stars within a sector, named and
 * grid-coded. Per ADR-019 (updated):
 *   - 2 clusters per Core quadrant × 4 quadrants = 8
 *   - 3 clusters per outer sector × 6 outer = 18
 *   - Total: 26
 *
 * Core quadrants subdivide into a 2 × 2 grid (letter A/B, band 1/2).
 * Outer sectors subdivide into 5 × 5 (letters A..E, bands 1..5).
 *
 * Cluster short code:
 *   `${sectorPrefix}-${letter}${band}` → e.g. "CN-A1", "ORN-B3"
 * Display name:
 *   `${fancy} Cluster (${code})` → "Kestrel Cluster (ORN-B3)"
 */

const FANCY_NAMES = [
  "Kestrel", "Orpheus", "Maelstrom", "Halcyon", "Prometheus", "Icarus",
  "Sable", "Zephyr", "Solstice", "Vortex", "Nimbus", "Hyperion",
  "Tethys", "Thule", "Pandora", "Argus", "Basilisk", "Tempest",
  "Echo", "Obsidian", "Mirage", "Chimera", "Vagrant", "Zenith",
  "Harbinger", "Rook", "Pale", "Wraith", "Siren", "Quill",
] as const;

export interface ClusterGridCell {
  letter: string;
  band: number;
}

export interface Cluster {
  id: string;
  sectorId: string;
  name: string;
  prefix: string;
  code: string;
  grid: ClusterGridCell;
  /** Center position on the galactic plane. */
  center: { x: number; y: number; z: number };
  /** Approximate radius within which stars belong. */
  spread: number;
}

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
      const center = gridCellCenter(sector, grid, galaxyRadius, rng);

      clusters.push({
        id,
        sectorId: sector.id,
        name: `${fancy} Cluster (${code})`,
        prefix: sector.prefix,
        code,
        grid,
        center,
        spread: galaxyRadius * rangeFloat(rng, 0.025, 0.055),
      });
    }
  }

  return clusters;
}

const OUTER_LETTERS = ["A", "B", "C", "D", "E"] as const;
const CORE_LETTERS = ["A", "B"] as const;

function sampleGridCell(rng: Rng, sector: Sector): ClusterGridCell {
  if (sector.kind === "core") {
    const letter = CORE_LETTERS[rangeInt(rng, 0, CORE_LETTERS.length - 1)]!;
    const band = rangeInt(rng, 1, 2);
    return { letter, band };
  }
  const letter = OUTER_LETTERS[rangeInt(rng, 0, OUTER_LETTERS.length - 1)]!;
  const band = rangeInt(rng, 1, 5);
  return { letter, band };
}

/**
 * Geometric center of a cluster grid cell in world coordinates with a
 * small random nudge so multiple clusters in the same cell don't stack.
 * Core quadrants use a 2 letters × 2 bands grid spanning the quadrant's
 * wedge; outer sectors use 5 × 5 spanning their wedge.
 */
function gridCellCenter(
  sector: Sector,
  grid: ClusterGridCell,
  galaxyRadius: number,
  rng: Rng,
): { x: number; y: number; z: number } {
  const letters: readonly string[] =
    sector.kind === "core" ? CORE_LETTERS : OUTER_LETTERS;
  const bandCount = sector.kind === "core" ? 2 : 5;
  const letterIdx = letters.indexOf(grid.letter);
  const bandIdx = grid.band - 1;

  const wedgeSpan = wedgeLength(sector.wedge);
  const angle =
    sector.wedge.start + ((letterIdx + 0.5) / letters.length) * wedgeSpan;

  const rInner = galaxyRadius * sector.innerR;
  const rOuter = galaxyRadius * sector.outerR;
  const radius = rInner + ((bandIdx + 0.5) / bandCount) * (rOuter - rInner);

  // Nudge within the cell (small jitter so same-cell clusters separate)
  const jitterR = ((rOuter - rInner) / bandCount) * 0.3;
  const jitterA = (wedgeSpan / letters.length) * 0.3;
  const jr = (rng() - 0.5) * jitterR;
  const ja = (rng() - 0.5) * jitterA;

  return {
    x: Math.cos(angle + ja) * (radius + jr),
    y: 0,
    z: Math.sin(angle + ja) * (radius + jr),
  };
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

export { CORE_INNER_RADIUS_FRACTION };
