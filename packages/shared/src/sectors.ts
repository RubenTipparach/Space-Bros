import { pick, rngFromSeed, type Rng } from "./rng.ts";

/**
 * Sector dictionary + generator. Per ADR-019 (updated after playtest):
 *
 *   4 Core quadrants (North / East / South / West) — this is the premium
 *     real estate so we want more clickable cells here.
 *   6 seeded outer sectors — each a 60° wedge with a
 *     dictionary-generated name ("Orion Reach", etc.).
 *
 * Sectors are annular-sector regions defined by (innerR, outerR) as
 * fractions of the galaxy radius + an angular wedge. Core quadrants
 * occupy (0, CORE_INNER_RADIUS_FRACTION); outer sectors occupy
 * (CORE_INNER_RADIUS_FRACTION, 1).
 */

export const CORE_INNER_RADIUS_FRACTION = 0.22;
export const OUTER_SECTOR_COUNT = 6;
export const CORE_QUADRANT_COUNT = 4;

export interface Sector {
  id: string;
  kind: "core" | "outer";
  name: string;
  prefix: string;
  /** Inclusive–exclusive radians. Wraps around at 2π. */
  wedge: { start: number; end: number };
  /** Inner radius as fraction of galaxy radius. */
  innerR: number;
  /** Outer radius as fraction of galaxy radius. */
  outerR: number;
}

const PROPER_NOUNS = [
  "Orion", "Perseus", "Cygnus", "Draco", "Lyra", "Aquila",
  "Corvus", "Scutum", "Norma", "Carina", "Vela", "Auriga",
  "Hydra", "Pavo", "Sagitta", "Eridanus", "Lupus", "Phoenix",
  "Cassiopeia", "Andromeda",
] as const;

const DESCRIPTORS = [
  "Reach", "Belt", "Arm", "Frontier", "Veil", "Expanse",
  "Wake", "Tide", "Shard", "Ember", "Halo", "Reef",
  "Gyre", "Spur", "Rim", "Hollow", "Drift", "Verge",
] as const;

/** Cardinal directions for Core quadrants, starting north, going clockwise. */
const CORE_QUADRANT_META = [
  { suffix: "North", prefix: "CN" },
  { suffix: "East",  prefix: "CE" },
  { suffix: "South", prefix: "CS" },
  { suffix: "West",  prefix: "CW" },
] as const;

export function generateSectors(seed: number | string): Sector[] {
  const rng = rngFromSeed(`${seed}:sectors`);
  const sectors: Sector[] = [];

  // 4 Core quadrants. North = top of the map (angle -π/2 in our math-y
  // coordinate system) so we rotate accordingly. We use angles in the
  // math convention (0 = +x axis, counter-clockwise).
  const quadrantSize = (Math.PI * 2) / CORE_QUADRANT_COUNT;
  // Start "North" at -π/4 so the N wedge straddles the +z axis (top).
  // In SVG coordinate space z increases downward so "North" is -z.
  const northStart = -Math.PI / 2 - quadrantSize / 2;
  for (let i = 0; i < CORE_QUADRANT_COUNT; i++) {
    const { suffix, prefix } = CORE_QUADRANT_META[i]!;
    const start = normAngle(northStart + i * quadrantSize);
    const end = normAngle(start + quadrantSize);
    sectors.push({
      id: `core_${suffix.toLowerCase()}`,
      kind: "core",
      name: `Core ${suffix}`,
      prefix,
      wedge: { start, end },
      innerR: 0,
      outerR: CORE_INNER_RADIUS_FRACTION,
    });
  }

  // 6 outer sectors — seeded dictionary pairs.
  const usedNouns = new Set<string>();
  const usedDescriptors = new Set<string>();
  const outerWedgeSize = (Math.PI * 2) / OUTER_SECTOR_COUNT;
  const outerStart = rng() * Math.PI * 2;
  for (let i = 0; i < OUTER_SECTOR_COUNT; i++) {
    const proper = pickUnique(rng, PROPER_NOUNS, usedNouns);
    const descriptor = pickUnique(rng, DESCRIPTORS, usedDescriptors);
    const start = normAngle(outerStart + i * outerWedgeSize);
    const end = normAngle(start + outerWedgeSize);
    sectors.push({
      id: `sec_${i}`,
      kind: "outer",
      name: `${proper} ${descriptor}`,
      prefix: proper.slice(0, 3).toUpperCase(),
      wedge: { start, end },
      innerR: CORE_INNER_RADIUS_FRACTION,
      outerR: 1,
    });
  }

  return sectors;
}

function pickUnique<T extends string>(rng: Rng, pool: readonly T[], used: Set<T>): T {
  if (used.size >= pool.length) return pick(rng, pool);
  while (true) {
    const choice = pick(rng, pool);
    if (!used.has(choice)) {
      used.add(choice);
      return choice;
    }
  }
}

/** Normalize an angle to [0, 2π). */
export function normAngle(a: number): number {
  const TWO_PI = Math.PI * 2;
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}

/** Returns true if `angle` is inside `wedge`, accounting for wrap-around. */
export function wedgeContains(
  wedge: { start: number; end: number },
  angle: number,
): boolean {
  const a = normAngle(angle);
  if (wedge.start <= wedge.end) {
    return a >= wedge.start && a < wedge.end;
  }
  return a >= wedge.start || a < wedge.end;
}

/** Angular length of a wedge, handling wrap-around. */
export function wedgeLength(wedge: { start: number; end: number }): number {
  const raw = wedge.end - wedge.start;
  return raw >= 0 ? raw : raw + Math.PI * 2;
}

/**
 * Classify a (x, z) position into its sector. Core quadrants win when
 * radius ≤ CORE_INNER_RADIUS_FRACTION; outer wedges own the rest.
 */
export function classifyPosition(
  x: number,
  z: number,
  galaxyRadius: number,
  sectors: Sector[],
): Sector {
  const r = Math.hypot(x, z);
  const rf = galaxyRadius > 0 ? r / galaxyRadius : 0;
  const angle = Math.atan2(z, x);

  if (rf < CORE_INNER_RADIUS_FRACTION) {
    for (const s of sectors) {
      if (s.kind === "core" && wedgeContains(s.wedge, angle)) return s;
    }
  }
  for (const s of sectors) {
    if (s.kind === "outer" && wedgeContains(s.wedge, angle)) return s;
  }
  // Fallback (numerical edge cases at wedge boundaries).
  return sectors[0]!;
}
