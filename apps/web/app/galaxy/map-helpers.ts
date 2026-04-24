import type { Cluster, Galaxy, Sector, Star } from "@space-bros/shared";

/**
 * Helpers for the 2D top-down galaxy map. Pure functions so they can be
 * tested without a DOM.
 */

// ---- Colors ---------------------------------------------------------------

/** 7 visually-distinct hues assigned by sector index. */
export const SECTOR_COLORS: readonly string[] = [
  "#d4a03e", // gold (Core)
  "#3a7fd0", // blue
  "#c94f5f", // red
  "#4fb56a", // green
  "#8b6fd4", // purple
  "#d48a47", // orange
  "#4fb8c8", // teal
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

/**
 * Bounding box around a sector wedge. We sample 64 points along the arc
 * from innerRadius to galaxyRadius and take their min/max — simpler
 * than computing the exact rectangle analytically, and stable for any
 * wedge geometry (including wrap-around).
 */
export function sectorBounds(
  sector: Sector,
  galaxy: Galaxy,
  pad = 1.15,
): Bounds {
  if (sector.kind === "core") {
    const r = galaxy.radius * 0.18 * pad; // CORE_INNER_RADIUS_FRACTION
    return { minX: -r, minZ: -r, maxX: r, maxZ: r };
  }
  const wedge = sector.wedge!;
  const innerR = galaxy.radius * sector.innerRadius;
  const outerR = galaxy.radius;

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const samples = 64;
  const TWO_PI = Math.PI * 2;
  let span = wedge.end - wedge.start;
  if (span < 0) span += TWO_PI;

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
  // Pad and square up so we don't squish the aspect ratio.
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const half = Math.max(maxX - minX, maxZ - minZ) / 2 * pad;
  return {
    minX: cx - half,
    minZ: cz - half,
    maxX: cx + half,
    maxZ: cz + half,
  };
}

export function clusterBounds(
  cluster: Cluster,
  _galaxy: Galaxy,
  pad = 1.4,
): Bounds {
  // Show a window around the cluster center big enough to see its spread
  // plus some surrounding empty space for context.
  const half = cluster.spread * 4 * pad;
  return {
    minX: cluster.center.x - half,
    minZ: cluster.center.z - half,
    maxX: cluster.center.x + half,
    maxZ: cluster.center.z + half,
  };
}

/** `viewBox` attribute string for an SVG sized to these bounds. */
export function viewBox(b: Bounds): string {
  return `${b.minX} ${b.minZ} ${b.maxX - b.minX} ${b.maxZ - b.minZ}`;
}

/** Map a galaxy (x, z) to canvas pixel coords given the current bounds. */
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

// ---- Sector wedge path ----------------------------------------------------

/**
 * Build an SVG path for an annular sector (wedge with a hole for the
 * Core). Works for wrap-around wedges too.
 */
export function wedgePath(
  sector: Sector,
  galaxy: Galaxy,
): string {
  if (sector.kind === "core") {
    const r = galaxy.radius * 0.18; // CORE_INNER_RADIUS_FRACTION
    return `M ${r},0 A ${r},${r} 0 1 1 -${r},0 A ${r},${r} 0 1 1 ${r},0 Z`;
  }
  const wedge = sector.wedge!;
  const innerR = galaxy.radius * sector.innerRadius;
  const outerR = galaxy.radius;
  let start = wedge.start;
  let end = wedge.end;
  let span = end - start;
  if (span < 0) span += Math.PI * 2;
  const largeArc = span > Math.PI ? 1 : 0;

  const x1 = Math.cos(start) * innerR;
  const y1 = Math.sin(start) * innerR;
  const x2 = Math.cos(start) * outerR;
  const y2 = Math.sin(start) * outerR;
  const x3 = Math.cos(end) * outerR;
  const y3 = Math.sin(end) * outerR;
  const x4 = Math.cos(end) * innerR;
  const y4 = Math.sin(end) * innerR;

  return [
    `M ${x1},${y1}`,
    `L ${x2},${y2}`,
    `A ${outerR},${outerR} 0 ${largeArc} 1 ${x3},${y3}`,
    `L ${x4},${y4}`,
    `A ${innerR},${innerR} 0 ${largeArc} 0 ${x1},${y1}`,
    `Z`,
  ].join(" ");
}

/** Geometric center of a sector wedge for label placement. */
export function sectorCenter(sector: Sector, galaxy: Galaxy): { x: number; z: number } {
  if (sector.kind === "core") return { x: 0, z: 0 };
  const wedge = sector.wedge!;
  const innerR = galaxy.radius * sector.innerRadius;
  const outerR = galaxy.radius;
  let mid = (wedge.start + wedge.end) / 2;
  // Handle wrap-around wedge (start > end means it crossed 2π).
  if (wedge.end < wedge.start) mid = (wedge.start + wedge.end + Math.PI * 2) / 2;
  const r = (innerR + outerR) / 2;
  return { x: Math.cos(mid) * r, z: Math.sin(mid) * r };
}

// ---- Dust particle generation --------------------------------------------

export interface DustParticle {
  x: number;
  z: number;
  alpha: number;
  color: string;
}

/**
 * Pre-computed dust scattered along the spiral arms with extra jitter.
 * Done once per galaxy, independent of zoom level. Not persisted —
 * regenerated from the galaxy seed on mount.
 */
export function generateDust(galaxy: Galaxy, count: number): DustParticle[] {
  // Simple deterministic LCG seeded from the galaxy seed so dust is
  // stable across reloads. We don't reuse rngFromSeed to avoid coupling.
  let seed = 0;
  const s = String(galaxy.seed);
  for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const result: DustParticle[] = [];
  const radius = galaxy.radius;
  const branches = 3; // match galaxy default
  const spin = 6;
  for (let i = 0; i < count; i++) {
    const r = rng() * radius;
    const branch = ((i % branches) / branches) * Math.PI * 2;
    const spinAngle = (r / radius) * spin;
    const jitterScale = 0.85 + rng() * 0.5; // wider spread than stars
    const sign = () => (rng() < 0.5 ? 1 : -1);
    const jitter = () => Math.pow(rng(), 2) * 0.45 * radius * sign() * jitterScale;
    const x = Math.cos(branch + spinAngle) * r + jitter();
    const z = Math.sin(branch + spinAngle) * r + jitter();
    // Color tint: warm near center, cool at rim.
    const t = Math.min(1, r / radius);
    const red = Math.round(230 - t * 110);
    const green = Math.round(180 - t * 70);
    const blue = Math.round(150 + t * 80);
    result.push({
      x,
      z,
      alpha: 0.05 + rng() * 0.12,
      color: `rgba(${red}, ${green}, ${blue},`,
    });
  }
  return result;
}
