import { rngFromSeed, weightedPick, rangeFloat, rangeInt, type Rng } from "./rng.ts";
import {
  CORE_INNER_RADIUS_FRACTION,
  classifyPosition,
  generateSectors,
  type Sector,
} from "./sectors.ts";
import {
  classifyClusterForStar,
  generateClusters,
  type Cluster,
} from "./clusters.ts";

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
  sectorId: string;
  clusterId: string;
}

export interface Galaxy {
  seed: number | string;
  generatorVersion: number;
  radius: number;
  stars: Star[];
  sectors: Sector[];
  clusters: Cluster[];
}

export interface GenerateGalaxyOptions {
  seed: number | string;
  starCount: number;
  radius?: number;
  thickness?: number;
  /** Arm count. 4 gives clear structure without obvious streaks. */
  branches?: number;
  /** Total swirl (radians) from center to rim. */
  spin?: number;
  /** Gaussian jitter magnitude as a fraction of radius. */
  randomness?: number;
  /** Legacy knob — currently unused by the 3-pass generator. */
  randomnessPower?: number;
}

/** Bumped each time the generator's output shape meaningfully changes. */
export const GENERATOR_VERSION = 3;

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

/**
 * Box-Muller-ish gaussian draw. Returns a standard-normal sample.
 * Sufficient for dust / jitter; not cryptographic.
 */
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

/**
 * Core bulge — tight gaussian around (0, 0) with a small vertical
 * thickness. Creates the bright central clump.
 */
function corePosition(rng: Rng, radius: number, thickness: number): XYZ {
  const sigma = radius * 0.08;
  return {
    x: gaussian(rng) * sigma,
    y: gaussian(rng) * thickness * 0.12,
    z: gaussian(rng) * sigma,
  };
}

/**
 * Disk scatter — exponential falloff in radius + uniform angle. Fills
 * the space between spiral arms with soft background stars, which is
 * what actually kills the "rigid branches" look.
 */
function diskPosition(rng: Rng, radius: number, thickness: number): XYZ {
  // Exponential with scale 0.38 × radius → most stars inside mid-disk,
  // long tail to the rim. Capped so the tail doesn't go past the rim.
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

/**
 * Arm star — straight-line branch with soft assignment + gaussian
 * perpendicular jitter, then a "swirl" rotates the point by an amount
 * proportional to its radius. This is the classic
 * straight-arms-then-bend technique (Devans, Beltoforion) and avoids
 * the single-radial-streak artifact of pure pow-based spirals.
 */
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
  // Soft branch assignment: pick a fractional branch with jitter in
  // branch-space so stars near a boundary can drift into the next arm.
  const softBranchF = rng() * opts.branches;
  const branchIdx = Math.floor(softBranchF);
  const branchJitter = ((softBranchF - branchIdx) - 0.5) * 0.6; // ±0.3
  const branchAngle =
    ((branchIdx + branchJitter) / opts.branches) * Math.PI * 2;

  // Uniform r; per-area density is higher near the core automatically.
  const r = rng() * opts.radius;

  // Gaussian along-radius perturbation (small) and perpendicular jitter
  // (the one that smears the arm). perpendicular scales with r, so core
  // arms are tight and rim arms fan out.
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

  const sectors = generateSectors(seed);
  const clusters = generateClusters({ seed, sectors, galaxyRadius: radius });

  const rng = rngFromSeed(seed);
  const stars: Star[] = new Array(starCount);

  // Allocation: 18% core bulge, 28% disk background, 54% arms.
  const coreCount = Math.floor(starCount * 0.18);
  const diskCount = Math.floor(starCount * 0.28);

  for (let i = 0; i < starCount; i++) {
    let pos: XYZ;
    if (i < coreCount) {
      pos = corePosition(rng, radius, thickness);
    } else if (i < coreCount + diskCount) {
      pos = diskPosition(rng, radius, thickness);
    } else {
      pos = armPosition(rng, { radius, thickness, branches, spin, randomness });
    }

    // Clamp stars to the disk so nothing escapes the visible galaxy.
    const r = Math.hypot(pos.x, pos.z);
    if (r > radius) {
      const s = radius / r;
      pos.x *= s;
      pos.z *= s;
    }

    const sector = classifyPosition(pos.x, pos.z, radius, sectors);
    let cluster = classifyClusterForStar(pos.x, pos.z, sector.id, clusters);
    if (!cluster) cluster = clusters[0]!;

    const spectralClass = weightedPick(rng, SPECTRAL_WEIGHTS);
    stars[i] = {
      id: i,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      spectralClass,
      planets: generatePlanets(rng, i),
      sectorId: sector.id,
      clusterId: cluster.id,
    };
  }

  return {
    seed,
    generatorVersion: GENERATOR_VERSION,
    radius,
    stars,
    sectors,
    clusters,
  };
}

export { CORE_INNER_RADIUS_FRACTION };
