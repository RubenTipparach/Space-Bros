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
  /** Sector id from the seeded sector dictionary. */
  sectorId: string;
  /** Cluster id this star belongs to. Every star has one. */
  clusterId: string;
}

export interface Galaxy {
  seed: number | string;
  generatorVersion: number;
  /** Radius of the galaxy disk in light-years. */
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
  /** Spiral branches — 2 major arms + 2 minor arms = 4 by default. */
  branches?: number;
  /** Spiral tightness. radius × spin = spinAngle. */
  spin?: number;
  /** 0..1 tangential jitter relative to radius. */
  randomness?: number;
  /** Higher = stars hug the arm spine more tightly. */
  randomnessPower?: number;
}

/**
 * Bumped to 2 for V-1 — we now emit sectors + clusters + tagged stars,
 * so stored data keyed by the old galaxy (e.g. `planet_overlays`) may
 * need backfill. No prod data exists yet so this is free today.
 */
export const GENERATOR_VERSION = 2;

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

/**
 * Three.js-Journey-style spiral galaxy position. Stars cluster into
 * `branches` arms with tangential randomness that falls off sharply
 * toward the arm spine.
 */
function spiralStarPosition(
  rng: Rng,
  starIndex: number,
  opts: {
    radius: number;
    thickness: number;
    branches: number;
    spin: number;
    randomness: number;
    randomnessPower: number;
  },
): { x: number; y: number; z: number; radius: number } {
  const r = Math.pow(rng(), opts.randomnessPower) * opts.radius;
  const branchAngle = ((starIndex % opts.branches) / opts.branches) * Math.PI * 2;
  const spinAngle = r * opts.spin;

  const sign = () => (rng() < 0.5 ? 1 : -1);
  const jitter = (scale: number) =>
    Math.pow(rng(), opts.randomnessPower) * opts.randomness * r * scale * sign();

  const rx = jitter(1);
  const ry = jitter(0.35); // flatter vertically than horizontally
  const rz = jitter(1);

  return {
    x: Math.cos(branchAngle + spinAngle) * r + rx,
    y: ry + (rng() - 0.5) * opts.thickness * (1 - r / opts.radius) * 0.3,
    z: Math.sin(branchAngle + spinAngle) * r + rz,
    radius: r,
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
  const spin = opts.spin ?? 1.2;
  const randomness = opts.randomness ?? 0.35;
  const randomnessPower = opts.randomnessPower ?? 3;

  const sectors = generateSectors(seed);
  const clusters = generateClusters({ seed, sectors, galaxyRadius: radius });

  const rng = rngFromSeed(seed);
  const stars: Star[] = new Array(starCount);

  // First pass: place stars, assign sector + cluster. We pull stars
  // toward the nearest cluster center so the hierarchy feels real.
  for (let i = 0; i < starCount; i++) {
    const pos = spiralStarPosition(rng, i, {
      radius,
      thickness,
      branches,
      spin,
      randomness,
      randomnessPower,
    });

    const sector = classifyPosition(pos.x, pos.z, radius, sectors);

    // Find the closest cluster in this sector; if one exists, bias the
    // star's position slightly toward the cluster center (keeps clumps
    // visible while preserving arm structure).
    let cluster = classifyClusterForStar(pos.x, pos.z, sector.id, clusters);
    if (!cluster && sector.id !== "core") {
      // Fallback: closest cluster anywhere (edge cases at wedge boundaries).
      cluster = classifyClusterForStar(pos.x, pos.z, "core", clusters);
    }
    if (!cluster) {
      // Shouldn't happen with non-zero clusters, but stay resilient.
      cluster = clusters[0]!;
    }

    // Pull 20% toward cluster center for visible clumping.
    const pullX = cluster.center.x - pos.x;
    const pullZ = cluster.center.z - pos.z;
    const dist = Math.hypot(pullX, pullZ);
    const pullFactor = 0.2 * Math.min(1, dist / Math.max(1, cluster.spread * 3));
    const x = pos.x + pullX * pullFactor;
    const z = pos.z + pullZ * pullFactor;

    const spectralClass = weightedPick(rng, SPECTRAL_WEIGHTS);
    stars[i] = {
      id: i,
      x,
      y: pos.y,
      z,
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
