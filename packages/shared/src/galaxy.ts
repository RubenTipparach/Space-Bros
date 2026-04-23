import { rngFromSeed, weightedPick, rangeFloat, rangeInt, type Rng } from "./rng.ts";

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
}

export interface Galaxy {
  seed: number | string;
  generatorVersion: number;
  stars: Star[];
}

export interface GenerateGalaxyOptions {
  seed: number | string;
  starCount: number;
  radius?: number;
  thickness?: number;
}

export const GENERATOR_VERSION = 1;

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

function randomStarPosition(rng: Rng, radius: number, thickness: number): { x: number; y: number; z: number } {
  // Disk distribution with mild spiral-ish bias: sample r with sqrt for area, y thin.
  const r = Math.sqrt(rng()) * radius;
  const theta = rng() * Math.PI * 2;
  const y = (rng() - 0.5) * thickness * (1 - r / radius);
  return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
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
  const rng = rngFromSeed(seed);
  const stars: Star[] = [];
  for (let i = 0; i < starCount; i++) {
    const pos = randomStarPosition(rng, radius, thickness);
    const spectralClass = weightedPick(rng, SPECTRAL_WEIGHTS);
    stars.push({
      id: i,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      spectralClass,
      planets: generatePlanets(rng, i),
    });
  }
  return { seed, generatorVersion: GENERATOR_VERSION, stars };
}
