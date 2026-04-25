import type { Biome, Star } from "@space-bros/shared";

/**
 * Colour tables used across the 3D scene. Normalised 0-1 values for
 * shader uniforms; CSS-string aliases provided for SVG-era consumers
 * (SystemView's planet preview still uses them).
 */

export const SPECTRAL_RGB: Record<Star["spectralClass"], [number, number, number]> = {
  O: [156 / 255, 176 / 255, 255 / 255],
  B: [170 / 255, 191 / 255, 255 / 255],
  A: [201 / 255, 215 / 255, 255 / 255],
  F: [248 / 255, 247 / 255, 255 / 255],
  G: [255 / 255, 244 / 255, 234 / 255],
  K: [255 / 255, 210 / 255, 161 / 255],
  M: [255 / 255, 173 / 255, 81 / 255],
};

/** 0-1 float triples for SystemView's SVG planet preview. */
export const SPECTRAL_COLORS = SPECTRAL_RGB;

/** Biome colour table, used by the SystemView SVG mini-orbit diagram. */
export const BIOME_COLORS: Record<Biome, string> = {
  molten: "#ff5e3a",
  rocky: "#8b6f50",
  desert: "#d4a85a",
  ocean: "#3676c8",
  earthlike: "#4fb56a",
  jungle: "#3c8d3c",
  tundra: "#b7c5d4",
  ice: "#dde9ff",
  gas: "#c7a373",
  toxic: "#a6d84f",
};

export const SPECTRAL_POINT_SIZE: Record<Star["spectralClass"], number> = {
  O: 2.6,
  B: 2.2,
  A: 1.9,
  F: 1.6,
  G: 1.4,
  K: 1.2,
  M: 1.0,
};

/**
 * 10 distinct hues for sector territory tint. Assigned by sector index
 * (cycle if more than 10 sectors). Warm core-ish first, cooler outer
 * later so the galactic centre reads hot when seen from afar.
 */
export const SECTOR_COLORS: readonly string[] = [
  "#d4a03e", // gold
  "#c94f5f", // red
  "#4fb56a", // green
  "#3a7fd0", // blue
  "#8b6fd4", // purple
  "#d48a47", // orange
  "#4fb8c8", // teal
  "#b3c24a", // yellow-green
  "#c8589a", // magenta
  "#6fa4ff", // sky blue
];
