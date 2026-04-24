import { Delaunay } from "d3-delaunay";
import { pick, rangeInt, rngFromSeed, type Rng } from "./rng.ts";

/**
 * Bottom-up hierarchy per ADR-019-revised: stars → groups → clusters →
 * sectors. Borders are real shared polygon edges because groups are
 * Voronoi cells of group centroids, clusters are aggregations of
 * groups, and sectors are aggregations of clusters.
 *
 * This file builds the whole tree; rendering (the actual polygon
 * meshes in 3D) happens in V-2.2 consumers.
 */

// ---- Types ----------------------------------------------------------------

export interface HGroup {
  id: string;
  /** Group centroid in (x, z) on the galactic plane. */
  centroid: [number, number];
  /** Closed polygon [[x, z], …]; null only if the cell was clipped empty. */
  polygon: number[][] | null;
  clusterId: string;
}

export interface HCluster {
  id: string;
  /** Display name, e.g. "Kestrel Cluster (ORN-03)". */
  name: string;
  /** Short code, e.g. "ORN-03". */
  code: string;
  /** Sector prefix, e.g. "ORN". */
  prefix: string;
  sectorId: string;
  centroid: [number, number];
  groupIds: string[];
}

export interface HSector {
  id: string;
  name: string;
  prefix: string;
  centroid: [number, number];
  clusterIds: string[];
}

export interface Hierarchy {
  groups: HGroup[];
  clusters: HCluster[];
  sectors: HSector[];
  /** Per-star membership. Length matches the input stars array. */
  starGroupIds: string[];
  starClusterIds: string[];
  starSectorIds: string[];
}

export interface BuildHierarchyOptions {
  seed: string | number;
  /** Only (x, z) are read — the galactic plane. */
  stars: readonly { readonly x: number; readonly z: number }[];
  /** Used to clip Voronoi cells so cells near the rim are finite. */
  galaxyRadius: number;
  /** ~1000 for a 12k-star galaxy; ≈ 12 stars per group. */
  groupCount?: number;
  /** ~60 for 1000 groups. */
  clusterCount?: number;
  /** ~10 — small enough to be legible at galaxy scale. */
  sectorCount?: number;
}

// ---- Name dictionaries ----------------------------------------------------

const PROPER_NOUNS = [
  "Orion", "Perseus", "Cygnus", "Draco", "Lyra", "Aquila",
  "Corvus", "Scutum", "Norma", "Carina", "Vela", "Auriga",
  "Hydra", "Pavo", "Sagitta", "Eridanus", "Lupus", "Phoenix",
  "Cassiopeia", "Andromeda", "Centaurus", "Tucana", "Volans",
  "Circinus",
] as const;

const DESCRIPTORS = [
  "Reach", "Belt", "Arm", "Frontier", "Veil", "Expanse",
  "Wake", "Tide", "Shard", "Ember", "Halo", "Reef",
  "Gyre", "Spur", "Rim", "Hollow", "Drift", "Verge",
] as const;

const FANCY_NAMES = [
  "Kestrel", "Orpheus", "Maelstrom", "Halcyon", "Prometheus", "Icarus",
  "Sable", "Zephyr", "Solstice", "Vortex", "Nimbus", "Hyperion",
  "Tethys", "Thule", "Pandora", "Argus", "Basilisk", "Tempest",
  "Echo", "Obsidian", "Mirage", "Chimera", "Vagrant", "Zenith",
  "Harbinger", "Rook", "Pale", "Wraith", "Siren", "Quill",
  "Oracle", "Talon", "Pyre", "Glacier", "Rift", "Warden",
] as const;

// ---- Utilities ------------------------------------------------------------

function weightedCentroid(points: readonly [number, number][], weights: readonly number[]):
  [number, number] {
  let wSum = 0;
  let xSum = 0;
  let ySum = 0;
  for (let i = 0; i < points.length; i++) {
    const w = weights[i] ?? 1;
    wSum += w;
    xSum += points[i]![0] * w;
    ySum += points[i]![1] * w;
  }
  if (wSum === 0) return [0, 0];
  return [xSum / wSum, ySum / wSum];
}

function pickUnique<T>(rng: Rng, pool: readonly T[], used: Set<T>): T {
  if (used.size >= pool.length) return pick(rng, pool);
  while (true) {
    const candidate = pick(rng, pool);
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

// ---- K-means (Lloyd's algorithm, seeded) ---------------------------------

interface KMeansResult {
  centroids: [number, number][];
  assignments: number[];
}

/**
 * Weighted k-means on 2D points. Centroid init picks `k` distinct
 * random points from the input set. Runs for `iterations` passes of
 * Lloyd's algorithm; that's enough for our scale to converge well
 * enough without needing a proper change-detection early exit.
 */
function kmeans2D(
  rng: Rng,
  points: readonly [number, number][],
  weights: readonly number[],
  k: number,
  iterations: number,
): KMeansResult {
  const n = points.length;
  if (k >= n) {
    return {
      centroids: points.map((p) => [p[0], p[1]]),
      assignments: points.map((_, i) => i),
    };
  }

  // Initial centroids — sample k distinct indices.
  const chosen = new Set<number>();
  while (chosen.size < k) {
    chosen.add(rangeInt(rng, 0, n - 1));
  }
  const centroids: [number, number][] = [...chosen].map((i) => [
    points[i]![0],
    points[i]![1],
  ]);

  const assignments = new Array<number>(n).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    // Assign each point to its nearest centroid using a Delaunay on
    // centroids for fast nearest-neighbour queries.
    const flat = new Float64Array(k * 2);
    for (let c = 0; c < k; c++) {
      flat[c * 2] = centroids[c]![0];
      flat[c * 2 + 1] = centroids[c]![1];
    }
    const d = new Delaunay(flat);
    for (let i = 0; i < n; i++) {
      assignments[i] = d.find(points[i]![0], points[i]![1]);
    }

    // Re-compute centroids as weighted means of assigned points.
    const sums: [number, number][] = Array.from({ length: k }, () => [0, 0]);
    const sumW = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i]!;
      const w = weights[i] ?? 1;
      sums[c]![0] += points[i]![0] * w;
      sums[c]![1] += points[i]![1] * w;
      sumW[c]! += w;
    }
    for (let c = 0; c < k; c++) {
      if (sumW[c]! > 0) {
        centroids[c] = [sums[c]![0] / sumW[c]!, sums[c]![1] / sumW[c]!];
      }
    }
  }

  return { centroids, assignments };
}

// ---- Main entry -----------------------------------------------------------

export function buildHierarchy(opts: BuildHierarchyOptions): Hierarchy {
  const groupCount = opts.groupCount ?? Math.max(100, Math.floor(opts.stars.length / 12));
  const clusterCount = opts.clusterCount ?? Math.max(10, Math.floor(groupCount / 16));
  const sectorCount = opts.sectorCount ?? 10;

  const rng = rngFromSeed(`${opts.seed}:hierarchy`);
  const stars = opts.stars;
  const n = stars.length;
  const R = opts.galaxyRadius;

  // --- Step 1: group centroids -- sampled from actual star positions so
  //     density matches the galaxy's distribution.
  const groupIndices = new Set<number>();
  while (groupIndices.size < Math.min(groupCount, n)) {
    groupIndices.add(rangeInt(rng, 0, n - 1));
  }
  const groupCentroids: [number, number][] = [...groupIndices].map((i) => [
    stars[i]!.x,
    stars[i]!.z,
  ]);

  // --- Step 2: Voronoi on group centroids, clipped to a bbox slightly
  //     larger than the galaxy disc. Cells at the rim may extend to the
  //     bbox edge but that's fine visually.
  const flat = new Float64Array(groupCentroids.length * 2);
  for (let i = 0; i < groupCentroids.length; i++) {
    flat[i * 2] = groupCentroids[i]![0];
    flat[i * 2 + 1] = groupCentroids[i]![1];
  }
  const delaunay = new Delaunay(flat);
  const bbox: [number, number, number, number] = [-R * 1.25, -R * 1.25, R * 1.25, R * 1.25];
  const voronoi = delaunay.voronoi(bbox);

  const groupPolys: (number[][] | null)[] = [];
  for (let i = 0; i < groupCentroids.length; i++) {
    const cell = voronoi.cellPolygon(i);
    if (!cell || cell.length < 3) {
      groupPolys.push(null);
      continue;
    }
    groupPolys.push(cell.map((p) => [p[0], p[1]]));
  }

  // --- Step 3: each star → nearest group centroid.
  const starGroupIdx = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    starGroupIdx[i] = delaunay.find(stars[i]!.x, stars[i]!.z);
  }
  const groupStarCounts = new Int32Array(groupCentroids.length);
  for (let i = 0; i < n; i++) groupStarCounts[starGroupIdx[i]!]! += 1;

  // --- Step 4: k-means aggregate groups → clusters.
  const groupWeights: number[] = Array.from(groupStarCounts, (v) => Math.max(1, v));
  const clusterK = Math.min(clusterCount, groupCentroids.length);
  const clusterResult = kmeans2D(rng, groupCentroids, groupWeights, clusterK, 12);

  // Resulting cluster centroid per group index is clusterResult.assignments[i].
  const groupClusterIdx = clusterResult.assignments;

  // --- Step 5: k-means aggregate clusters → sectors. Weight cluster
  //     centroids by total star count in that cluster.
  const clusterStarCounts = new Int32Array(clusterK);
  for (let i = 0; i < groupCentroids.length; i++) {
    clusterStarCounts[groupClusterIdx[i]!]! += groupStarCounts[i]!;
  }
  const clusterWeights: number[] = Array.from(clusterStarCounts, (v) => Math.max(1, v));
  const sectorK = Math.min(sectorCount, clusterK);
  const sectorResult = kmeans2D(rng, clusterResult.centroids, clusterWeights, sectorK, 12);
  const clusterSectorIdx = sectorResult.assignments;

  // --- Step 6: name sectors + clusters.
  const sectorNameRng = rngFromSeed(`${opts.seed}:names:sectors`);
  const usedNouns = new Set<string>();
  const usedDescriptors = new Set<string>();
  const sectors: HSector[] = sectorResult.centroids.map((c, i) => {
    const proper = pickUnique(sectorNameRng, PROPER_NOUNS, usedNouns);
    const descriptor = pickUnique(sectorNameRng, DESCRIPTORS, usedDescriptors);
    return {
      id: `sec_${i}`,
      name: `${proper} ${descriptor}`,
      prefix: proper.slice(0, 3).toUpperCase(),
      centroid: [c[0], c[1]],
      clusterIds: [],
    };
  });

  // Clusters per sector, indexed for naming and aggregation.
  const clustersBySector: number[][] = Array.from({ length: sectorK }, () => []);
  for (let i = 0; i < clusterK; i++) {
    clustersBySector[clusterSectorIdx[i]!]!.push(i);
  }

  const clusterNameRng = rngFromSeed(`${opts.seed}:names:clusters`);
  const clusters: HCluster[] = new Array(clusterK);
  for (let si = 0; si < sectorK; si++) {
    const sector = sectors[si]!;
    const list = clustersBySector[si]!;
    list.sort((a, b) => clusterStarCounts[b]! - clusterStarCounts[a]!);
    for (let j = 0; j < list.length; j++) {
      const ci = list[j]!;
      const fancy = pick(clusterNameRng, FANCY_NAMES);
      const code = `${sector.prefix}-${String(j + 1).padStart(2, "0")}`;
      clusters[ci] = {
        id: `cls_${ci}`,
        name: `${fancy} Cluster (${code})`,
        code,
        prefix: sector.prefix,
        sectorId: sector.id,
        centroid: [clusterResult.centroids[ci]![0], clusterResult.centroids[ci]![1]],
        groupIds: [],
      };
      sector.clusterIds.push(clusters[ci]!.id);
    }
  }

  // --- Step 7: materialise groups.
  const groups: HGroup[] = groupCentroids.map((centroid, i) => {
    const clusterIdx = groupClusterIdx[i]!;
    return {
      id: `grp_${i}`,
      centroid: [centroid[0], centroid[1]],
      polygon: groupPolys[i] ?? null,
      clusterId: clusters[clusterIdx]!.id,
    };
  });

  for (let i = 0; i < groups.length; i++) {
    const clusterIdx = groupClusterIdx[i]!;
    clusters[clusterIdx]!.groupIds.push(groups[i]!.id);
  }

  // --- Step 8: per-star membership arrays.
  const starGroupIds = new Array<string>(n);
  const starClusterIds = new Array<string>(n);
  const starSectorIds = new Array<string>(n);
  for (let i = 0; i < n; i++) {
    const gi = starGroupIdx[i]!;
    const ci = groupClusterIdx[gi]!;
    const si = clusterSectorIdx[ci]!;
    starGroupIds[i] = groups[gi]!.id;
    starClusterIds[i] = clusters[ci]!.id;
    starSectorIds[i] = sectors[si]!.id;
  }

  return { groups, clusters, sectors, starGroupIds, starClusterIds, starSectorIds };
}
