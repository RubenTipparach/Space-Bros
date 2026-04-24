import { rngFromSeed, weightedPick, rangeFloat, rangeInt, type Rng } from "./rng.ts";
import {
  buildHierarchy,
  type HCluster,
  type HGroup,
  type HSector,
} from "./hierarchy.ts";

export type SpectralClass = "O" | "B" | "A" | "F" | "G" | "K" | "M";

export type Biome =
  | "molten"
  | "rocky"
  | "desert"
  | "ocean"
  | "earthlike"
  | "jungle"
  | "tundra"
  | "ice"
  | "gas"
  | "toxic";

export interface Planet {
  id: string;
  index: number;
  biome: Biome;
  habitability: number;
  size: number;
  orbitAu: number;
}

export interface Star {
  id: number;
  x: number;
  y: number;
  z: number;
  spectralClass: SpectralClass;
  planets: Planet[];
  groupId: string;
  clusterId: string;
  sectorId: string;
}

/**
 * Re-exports for convenience — consumers can `import { Sector } from
 * "@space-bros/shared"` without remembering which file it lives in.
 */
export type Sector = HSector;
export type Cluster = HCluster;
export type Group = HGroup;

export interface Galaxy {
  seed: number | string;
  generatorVersion: number;
  radius: number;
  stars: Star[];
  sectors: Sector[];
  clusters: Cluster[];
  groups: Group[];
}

export interface GenerateGalaxyOptions {
  seed: number | string;
  starCount: number;
  radius?: number;
  thickness?: number;
  branches?: number;
  spin?: number;
  randomness?: number;
  /** ~12 stars per group. */
  groupCount?: number;
  /** ~16 groups per cluster. */
  clusterCount?: number;
  /** Target count for named top-level regions. */
  sectorCount?: number;
}

/**
 * Bumped to 4 for V-2.1 — star shape adds `groupId`, galaxy shape adds
 * `groups[]`, sectors/clusters are now bottom-up aggregations so any
 * downstream code that indexed them by wedge math is broken.
 */
export const GENERATOR_VERSION = 4;

const SPECTRAL_WEIGHTS: readonly (readonly [SpectralClass, number])[] = [
  ["O", 0.0001],
  ["B", 0.001],
  ["A", 0.006],
  ["F", 0.03],
  ["G", 0.076],
  ["K", 0.121],
  ["M", 0.7659],
];

const BIOME_WEIGHTS: readonly (readonly [Biome, number])[] = [
  ["molten", 0.12],
  ["rocky", 0.22],
  ["desert", 0.12],
  ["ocean", 0.08],
  ["earthlike", 0.03],
  ["jungle", 0.04],
  ["tundra", 0.08],
  ["ice", 0.12],
  ["gas", 0.15],
  ["toxic", 0.04],
];

const BIOME_HABITABILITY: Record<Biome, number> = {
  molten: 0.0,
  rocky: 0.1,
  desert: 0.3,
  ocean: 0.55,
  earthlike: 0.95,
  jungle: 0.75,
  tundra: 0.35,
  ice: 0.15,
  gas: 0.0,
  toxic: 0.05,
};

// ---- Three-pass star position generator ----------------------------------

function gaussian(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface XYZ {
  x: number;
  y: number;
  z: number;
}

function corePosition(rng: Rng, radius: number, thickness: number): XYZ {
  const sigma = radius * 0.08;
  return {
    x: gaussian(rng) * sigma,
    y: gaussian(rng) * thickness * 0.12,
    z: gaussian(rng) * sigma,
  };
}

function diskPosition(rng: Rng, radius: number, thickness: number): XYZ {
  let r = 0;
  for (let tries = 0; tries < 8; tries++) {
    r = -Math.log(1 - rng()) * radius * 0.38;
    if (r < radius) break;
    r = rng() * radius;
  }
  const theta = rng() * Math.PI * 2;
  return {
    x: Math.cos(theta) * r,
    y: gaussian(rng) * thickness * 0.08,
    z: Math.sin(theta) * r,
  };
}

function armPosition(
  rng: Rng,
  opts: {
    radius: number;
    thickness: number;
    branches: number;
    spin: number;
    randomness: number;
  },
): XYZ {
  const softBranchF = rng() * opts.branches;
  const branchIdx = Math.floor(softBranchF);
  const branchJitter = ((softBranchF - branchIdx) - 0.5) * 0.6;
  const branchAngle = ((branchIdx + branchJitter) / opts.branches) * Math.PI * 2;
  const r = rng() * opts.radius;
  const radialJitter = gaussian(rng) * opts.radius * 0.02;
  const perpJitter = gaussian(rng) * (r * opts.randomness + opts.radius * 0.04);
  const swirl = (r / Math.max(1, opts.radius)) * opts.spin;
  const angle = branchAngle + swirl;
  const perpAngle = angle + Math.PI / 2;
  const eR = r + radialJitter;
  return {
    x: Math.cos(angle) * eR + Math.cos(perpAngle) * perpJitter,
    y: gaussian(rng) * opts.thickness * 0.08,
    z: Math.sin(angle) * eR + Math.sin(perpAngle) * perpJitter,
  };
}

function generatePlanets(rng: Rng, starId: number): Planet[] {
  const count = rangeInt(rng, 0, 8);
  const planets: Planet[] = [];
  for (let i = 0; i < count; i++) {
    const biome = weightedPick(rng, BIOME_WEIGHTS);
    const habBase = BIOME_HABITABILITY[biome];
    planets.push({
      id: `${starId}:${i}`,
      index: i,
      biome,
      habitability: Math.max(0, Math.min(1, habBase + rangeFloat(rng, -0.1, 0.1))),
      size: rangeFloat(rng, 0.3, 2.5),
      orbitAu: rangeFloat(rng, 0.2, 40),
    });
  }
  return planets;
}

export function generateGalaxy(opts: GenerateGalaxyOptions): Galaxy {
  const { seed, starCount } = opts;
  const radius = opts.radius ?? 500;
  const thickness = opts.thickness ?? 40;
  const branches = opts.branches ?? 4;
  const spin = opts.spin ?? 3.2;
  const randomness = opts.randomness ?? 0.18;

  const rng = rngFromSeed(seed);
  const rawPositions: XYZ[] = new Array(starCount);

  const coreCount = Math.floor(starCount * 0.18);
  const diskCount = Math.floor(starCount * 0.28);
  const softRadius = radius * 1.18;

  for (let i = 0; i < starCount; i++) {
    let pos: XYZ;
    if (i < coreCount) pos = corePosition(rng, radius, thickness);
    else if (i < coreCount + diskCount) pos = diskPosition(rng, radius, thickness);
    else pos = armPosition(rng, { radius, thickness, branches, spin, randomness });

    const r = Math.hypot(pos.x, pos.z);
    if (r > radius) {
      const over = (r - radius) / (softRadius - radius);
      const keep = Math.exp(-over * 3);
      if (rng() > keep) {
        const target = radius * (0.85 + rng() * 0.12);
        const s = target / r;
        pos.x *= s;
        pos.z *= s;
      } else if (r > softRadius) {
        const s = softRadius / r;
        pos.x *= s;
        pos.z *= s;
      }
    }
    rawPositions[i] = pos;
  }

  // Build the bottom-up hierarchy from the star positions — this runs
  // k-means / Voronoi over the full population, so it must happen
  // AFTER the stars are placed.
  const hierarchy = buildHierarchy({
    seed,
    stars: rawPositions.map((p) => ({ x: p.x, z: p.z })),
    galaxyRadius: radius,
    groupCount: opts.groupCount,
    clusterCount: opts.clusterCount,
    sectorCount: opts.sectorCount,
  });

  const stars: Star[] = new Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const pos = rawPositions[i]!;
    const spectralClass = weightedPick(rng, SPECTRAL_WEIGHTS);
    stars[i] = {
      id: i,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      spectralClass,
      planets: generatePlanets(rng, i),
      groupId: hierarchy.starGroupIds[i]!,
      clusterId: hierarchy.starClusterIds[i]!,
      sectorId: hierarchy.starSectorIds[i]!,
    };
  }

  return {
    seed,
    generatorVersion: GENERATOR_VERSION,
    radius,
    stars,
    sectors: hierarchy.sectors,
    clusters: hierarchy.clusters,
    groups: hierarchy.groups,
  };
}
