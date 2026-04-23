import type { SpectralClass, Biome } from "@space-bros/shared";

export const SPECTRAL_COLORS: Record<SpectralClass, [number, number, number]> = {
  O: [0.61, 0.69, 1.0],
  B: [0.67, 0.75, 1.0],
  A: [0.79, 0.84, 1.0],
  F: [0.97, 0.97, 1.0],
  G: [1.0, 0.96, 0.92],
  K: [1.0, 0.82, 0.63],
  M: [1.0, 0.68, 0.32],
};

export const SPECTRAL_SIZES: Record<SpectralClass, number> = {
  O: 2.2,
  B: 1.7,
  A: 1.4,
  F: 1.15,
  G: 1.0,
  K: 0.85,
  M: 0.65,
};

export const BIOME_COLORS: Record<Biome, string> = {
  molten: "#ff5533",
  rocky: "#8a7a6a",
  desert: "#d4a85b",
  ocean: "#3a7fd0",
  earthlike: "#4fb56a",
  jungle: "#2f8a3a",
  tundra: "#9fb8c4",
  ice: "#cfe7ff",
  gas: "#c89a6a",
  toxic: "#9acc4b",
};
