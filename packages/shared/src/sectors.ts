import { pick, rngFromSeed, type Rng } from "./rng.ts";

/**
 * Sector dictionary + generator. Per ADR-019: 1 Core sector (fixed,
 * innermost radius) + 6 seeded outer sectors. Each outer sector owns
 * a 60° angular wedge of the spiral.
 *
 * Names are built by pairing a proper-noun ("Orion") with a descriptor
 * ("Reach"), both picked from the seeded RNG. The short prefix is the
 * first three letters of the proper noun (uppercased).
 */

export const OUTER_SECTOR_COUNT = 6;

export interface Sector {
  id: string;             // "core" or `sec_${i}`
  kind: "core" | "outer";
  name: string;           // "Orion Reach" or "The Core"
  prefix: string;         // "CRE" or "ORN"
  /** Inclusive–exclusive radians. `null` for Core. */
  wedge: { start: number; end: number } | null;
  /**
   * For outer sectors: only stars with radius ≥ `innerRadius` belong.
   * Inside this, the Core claims them.
   */
  innerRadius: number;
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

export const CORE_INNER_RADIUS_FRACTION = 0.18;

/**
 * Deterministic sector set for a given galaxy seed. Radii are
 * _fractions_ of the galaxy radius, not absolute — multiply by
 * `galaxy.radius` at the call site.
 */
export function generateSectors(seed: number | string): Sector[] {
  const rng = rngFromSeed(`${seed}:sectors`);
  const sectors: Sector[] = [];

  sectors.push({
    id: "core",
    kind: "core",
    name: "The Core",
    prefix: "CRE",
    wedge: null,
    innerRadius: 0,
  });

  const usedNouns = new Set<string>();
  const usedDescriptors = new Set<string>();
  // Offset the first wedge by a random angle so the layout doesn't
  // always start at zero.
  const wedgeOffset = rng() * Math.PI * 2;
  const wedgeSize = (Math.PI * 2) / OUTER_SECTOR_COUNT;

  for (let i = 0; i < OUTER_SECTOR_COUNT; i++) {
    const proper = pickUnique(rng, PROPER_NOUNS, usedNouns);
    const descriptor = pickUnique(rng, DESCRIPTORS, usedDescriptors);
    const start = (wedgeOffset + i * wedgeSize) % (Math.PI * 2);
    const end = (start + wedgeSize) % (Math.PI * 2);
    sectors.push({
      id: `sec_${i}`,
      kind: "outer",
      name: `${proper} ${descriptor}`,
      prefix: proper.slice(0, 3).toUpperCase(),
      wedge: { start, end },
      innerRadius: CORE_INNER_RADIUS_FRACTION,
    });
  }

  return sectors;
}

function pickUnique<T extends string>(rng: Rng, pool: readonly T[], used: Set<T>): T {
  // Fall back to any if we've exhausted unique options (shouldn't with
  // 20+ nouns / 18 descriptors and only 6 outer sectors, but be safe).
  if (used.size >= pool.length) {
    return pick(rng, pool);
  }
  while (true) {
    const choice = pick(rng, pool);
    if (!used.has(choice)) {
      used.add(choice);
      return choice;
    }
  }
}

/** Returns true if `angle` is inside `wedge`, accounting for wrap-around. */
export function wedgeContains(
  wedge: { start: number; end: number },
  angle: number,
): boolean {
  const TWO_PI = Math.PI * 2;
  const a = ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  if (wedge.start <= wedge.end) {
    return a >= wedge.start && a < wedge.end;
  }
  // Wedge wraps across 2π.
  return a >= wedge.start || a < wedge.end;
}

/**
 * Classify a 3D position (x, z plane = galactic plane) into a sector.
 * Radius is the distance from the galactic center on that plane.
 * `radiusFraction` = radius / galaxyRadius — compare to
 * `sector.innerRadius` which is also a fraction.
 */
export function classifyPosition(
  x: number,
  z: number,
  galaxyRadius: number,
  sectors: Sector[],
): Sector {
  const r = Math.hypot(x, z);
  const rf = galaxyRadius > 0 ? r / galaxyRadius : 0;
  if (rf < CORE_INNER_RADIUS_FRACTION) {
    return sectors[0]!;
  }
  const angle = Math.atan2(z, x);
  for (let i = 1; i < sectors.length; i++) {
    const s = sectors[i]!;
    if (s.wedge && wedgeContains(s.wedge, angle)) return s;
  }
  return sectors[0]!; // fallback
}
