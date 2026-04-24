import type { Cluster, Galaxy, Sector, Star } from "@space-bros/shared";

/**
 * Helpers for the 2D top-down galaxy map. Pure functions so they can be
 * tested without a DOM.
 */

// ---- Colors ---------------------------------------------------------------

/**
 * 10 visually-distinct hues — 4 Core quadrants (warm) + 6 outer sectors
 * (cool to warm). Assigned by sector index in the order generateSectors
 * returns them.
 */
export const SECTOR_COLORS: readonly string[] = [
  "#ffb04a", // Core North  – gold
  "#ff8a3d", // Core East   – orange
  "#e16a5f", // Core South  – coral
  "#d4a03e", // Core West   – amber
  "#3a7fd0", // outer 1     – blue
  "#c94f5f", // outer 2     – red
  "#4fb56a", // outer 3     – green
  "#8b6fd4", // outer 4     – purple
  "#d48a47", // outer 5     – orange
  "#4fb8c8", // outer 6     – teal
];

export function sectorColor(sector: Sector, sectors: readonly Sector[]): string {
  const idx = sectors.indexOf(sector);
  return SECTOR_COLORS[idx % SECTOR_COLORS.length]!;
}

export const SPECTRAL_RGB: Record<Star["spectralClass"], [number, number, number]> = {
  O: [156, 176, 255],
  B: [170, 191, 255],
  A: [201, 215, 255],
  F: [248, 247, 255],
  G: [255, 244, 234],
  K: [255, 210, 161],
  M: [255, 173, 81],
};

export function spectralCss(star: Star, alpha: number = 1): string {
  const [r, g, b] = SPECTRAL_RGB[star.spectralClass];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const SPECTRAL_CANVAS_RADIUS: Record<Star["spectralClass"], number> = {
  O: 2.3,
  B: 2.0,
  A: 1.7,
  F: 1.5,
  G: 1.3,
  K: 1.1,
  M: 1.0,
};

// ---- Coordinate projection ------------------------------------------------

export interface Bounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function galaxyBounds(galaxy: Galaxy, pad = 1.0): Bounds {
  const r = galaxy.radius * pad;
  return { minX: -r, minZ: -r, maxX: r, maxZ: r };
}

function normAngle(a: number): number {
  const TWO_PI = Math.PI * 2;
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}

function wedgeSpan(wedge: { start: number; end: number }): number {
  const raw = wedge.end - wedge.start;
  return raw >= 0 ? raw : raw + Math.PI * 2;
}

export function sectorBounds(sector: Sector, galaxy: Galaxy, pad = 1.15): Bounds {
  const innerR = galaxy.radius * sector.innerR;
  const outerR = galaxy.radius * sector.outerR;
  const wedge = sector.wedge;
  const span = wedgeSpan(wedge);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const samples = 64;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const angle = wedge.start + t * span;
    for (const r of [innerR, outerR, (innerR + outerR) / 2]) {
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      if (x < minX) minX = x;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (z > maxZ) maxZ = z;
    }
  }
  // If this is a Core quadrant the inner radius is 0; include the
  // vertex at the center too.
  if (sector.innerR === 0) {
    minX = Math.min(minX, 0);
    minZ = Math.min(minZ, 0);
    maxX = Math.max(maxX, 0);
    maxZ = Math.max(maxZ, 0);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const half = (Math.max(maxX - minX, maxZ - minZ) / 2) * pad;
  return { minX: cx - half, minZ: cz - half, maxX: cx + half, maxZ: cz + half };
}

export function clusterBounds(cluster: Cluster, _galaxy: Galaxy, pad = 1.4): Bounds {
  const half = cluster.spread * 4 * pad;
  return {
    minX: cluster.center.x - half,
    minZ: cluster.center.z - half,
    maxX: cluster.center.x + half,
    maxZ: cluster.center.z + half,
  };
}

export function viewBox(b: Bounds): string {
  return `${b.minX} ${b.minZ} ${b.maxX - b.minX} ${b.maxZ - b.minZ}`;
}

export function project(
  x: number,
  z: number,
  b: Bounds,
  width: number,
  height: number,
): { px: number; py: number } {
  const u = (x - b.minX) / (b.maxX - b.minX);
  const v = (z - b.minZ) / (b.maxZ - b.minZ);
  return { px: u * width, py: v * height };
}

// ---- Sector wedge path (organic, noise-perturbed boundary) ---------------
//
// Red Blob Games polygonal-maps approach, adapted for our radial layout:
//   1. Every boundary between two sectors is a shared, noise-subdivided
//      curve. The noise key is derived from the boundary's identity so
//      neighbouring sectors compute the IDENTICAL curve and their edges
//      kiss perfectly — no gaps, no overlaps.
//   2. Radial boundaries perturb tangentially (perpendicular to the
//      radial line) so the straight pie-slice edge bends in and out of
//      the sector.
//   3. Outer-arc boundaries perturb radially (in/out from center).
//   4. Per-boundary seed + multi-octave sin harmonics give a smooth,
//      continuous wobble.

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Shared-key noise: a value in roughly [-1, 1] that depends on the key
 * and a parameter `t`. Four octaves of sin with per-octave phase shifts
 * derived from the key.
 */
function sharedNoise(key: string, t: number): number {
  let h = hashString(key);
  let v = 0;
  let amp = 1;
  let freq = 2;
  let total = 0;
  for (let o = 0; o < 4; o++) {
    const phase = (h % 10000) / 10000 * Math.PI * 2;
    v += amp * Math.sin(t * freq + phase);
    total += amp;
    h = Math.imul(h, 1103515245) + 12345;
    amp *= 0.55;
    freq *= 1.9;
  }
  return v / total;
}

/** Radial-boundary key: same angle from both adjacent sectors → same key. */
function radialBoundaryKey(angle: number): string {
  // Round to ~3e-6 radian precision so floating-point wobble doesn't
  // split the key between neighbours.
  return `rad:${Math.round(normAngle(angle) * 1_000_000)}`;
}

/** Outer-arc key: per-sector so adjacent outer wedges don't share arcs. */
function outerArcKey(sector: Sector): string {
  return `arc:${sector.id}`;
}

const RADIAL_AMPLITUDE = 0.12;        // fraction of galaxy radius
const OUTER_ARC_AMPLITUDE = 0.09;     // outer edge of outer sectors
const INNER_ARC_AMPLITUDE = 0.04;     // boundary between Core and outer

const RADIAL_SAMPLES = 28;
const OUTER_ARC_SAMPLES = 48;
const INNER_ARC_SAMPLES = 32;

/**
 * Build an SVG path for a sector as a perturbed-polygon annular sector.
 * Neighbours share radial-boundary noise keys so their wobbles align.
 */
export function wedgePath(sector: Sector, galaxy: Galaxy): string {
  const innerR = galaxy.radius * sector.innerR;
  const outerR = galaxy.radius * sector.outerR;
  const wedge = sector.wedge;
  const span = wedgeSpan(wedge);
  const points: [number, number][] = [];

  // 1) Start radial boundary: walk inner → outer along wedge.start.
  const startKey = radialBoundaryKey(wedge.start);
  for (let i = 0; i <= RADIAL_SAMPLES; i++) {
    const t = i / RADIAL_SAMPLES;
    const r = innerR + t * (outerR - innerR);
    // Offset perpendicular to the radial line (tangent to the arc at r).
    const offset = sharedNoise(startKey, t * 4) * galaxy.radius * RADIAL_AMPLITUDE * 0.5
                 * easeAtEnds(t); // taper at vertex ends so corners still meet
    const perpAngle = wedge.start + Math.PI / 2;
    const x = Math.cos(wedge.start) * r + Math.cos(perpAngle) * offset;
    const z = Math.sin(wedge.start) * r + Math.sin(perpAngle) * offset;
    points.push([x, z]);
  }

  // 2) Outer arc: wedge.start → wedge.end, perturbed radially.
  const arcKey = outerArcKey(sector);
  for (let i = 1; i <= OUTER_ARC_SAMPLES; i++) {
    const t = i / OUTER_ARC_SAMPLES;
    const angle = wedge.start + t * span;
    const n = sharedNoise(arcKey, t * 3);
    const r = outerR * (1 + n * OUTER_ARC_AMPLITUDE * easeAtEnds(t));
    points.push([Math.cos(angle) * r, Math.sin(angle) * r]);
  }

  // 3) End radial boundary: walk outer → inner along wedge.end.
  const endKey = radialBoundaryKey(wedge.end);
  for (let i = 1; i <= RADIAL_SAMPLES; i++) {
    const t = i / RADIAL_SAMPLES;
    const r = outerR - t * (outerR - innerR);
    // Note: walking outer→inner = parameter (1 - t) from the OTHER
    // sector's perspective. Use (1 - t) so the boundary matches.
    const offset = sharedNoise(endKey, (1 - t) * 4) * galaxy.radius * RADIAL_AMPLITUDE * 0.5
                 * easeAtEnds(1 - t);
    const perpAngle = wedge.end + Math.PI / 2;
    const x = Math.cos(wedge.end) * r + Math.cos(perpAngle) * offset;
    const z = Math.sin(wedge.end) * r + Math.sin(perpAngle) * offset;
    points.push([x, z]);
  }

  // 4) Inner closure — arc back, or point at origin for Core quadrants.
  if (sector.innerR === 0) {
    points.push([0, 0]);
  } else {
    const innerKey = outerArcKey(sector) + ":inner";
    for (let i = 1; i <= INNER_ARC_SAMPLES; i++) {
      const t = i / INNER_ARC_SAMPLES;
      const angle = wedge.end - t * span;
      const n = sharedNoise(innerKey, t * 2);
      const r = innerR * (1 + n * INNER_ARC_AMPLITUDE * easeAtEnds(t));
      points.push([Math.cos(angle) * r, Math.sin(angle) * r]);
    }
  }

  let d = `M ${points[0]![0]},${points[0]![1]}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i]![0]},${points[i]![1]}`;
  }
  d += " Z";
  return d;
}

/**
 * Smooth-step-ish taper that goes to 0 at t=0 and t=1, peak in middle.
 * Keeps boundary vertices anchored so corners between sectors stay
 * tight while the middles of the edges wobble.
 */
function easeAtEnds(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 4 * x * (1 - x); // parabola peaking at 1 at t=0.5
}

/**
 * Geometric center of a sector wedge for label placement.
 *
 * Core quadrants put their label at 75% of the outer rim (not the
 * midpoint) so four labels at 90° apart don't pile up at the origin.
 */
export function sectorCenter(sector: Sector, galaxy: Galaxy): { x: number; z: number } {
  const wedge = sector.wedge;
  const span = wedgeSpan(wedge);
  const mid = normAngle(wedge.start + span / 2);
  const rCenter =
    sector.kind === "core"
      ? galaxy.radius * sector.outerR * 0.75
      : galaxy.radius * (sector.innerR + sector.outerR) / 2;
  return { x: Math.cos(mid) * rCenter, z: Math.sin(mid) * rCenter };
}

// ---- Dust particle generation --------------------------------------------

export interface DustParticle {
  x: number;
  z: number;
  alpha: number;
  color: string;
}

export function generateDust(galaxy: Galaxy, count: number): DustParticle[] {
  let seed = 0;
  const s = String(galaxy.seed);
  for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const result: DustParticle[] = [];
  const radius = galaxy.radius;
  const branches = 4;
  const spin = 3.2;
  for (let i = 0; i < count; i++) {
    // Blend of disk + arm dust. 40% pure disk, 60% arm-aligned.
    let x: number;
    let z: number;
    if (rng() < 0.4) {
      // Disk
      const r = Math.pow(rng(), 0.8) * radius;
      const theta = rng() * Math.PI * 2;
      x = Math.cos(theta) * r;
      z = Math.sin(theta) * r;
    } else {
      // Arm
      const softBranchF = rng() * branches;
      const branchIdx = Math.floor(softBranchF);
      const branchJitter = ((softBranchF - branchIdx) - 0.5) * 0.7;
      const branchAngle =
        ((branchIdx + branchJitter) / branches) * Math.PI * 2;
      const r = rng() * radius;
      const swirl = (r / radius) * spin;
      const angle = branchAngle + swirl;
      const perpJitter = gauss() * (r * 0.28 + radius * 0.06);
      const perpAngle = angle + Math.PI / 2;
      x = Math.cos(angle) * r + Math.cos(perpAngle) * perpJitter;
      z = Math.sin(angle) * r + Math.sin(perpAngle) * perpJitter;
    }

    const r = Math.hypot(x, z);
    const t = Math.min(1, r / radius);
    const red = Math.round(230 - t * 110);
    const green = Math.round(180 - t * 70);
    const blue = Math.round(150 + t * 80);
    result.push({
      x,
      z,
      alpha: 0.04 + rng() * 0.12,
      color: `rgba(${red}, ${green}, ${blue},`,
    });
  }
  return result;
}
