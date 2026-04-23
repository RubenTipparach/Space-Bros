import { generateGalaxy, type Galaxy } from "@space-bros/shared";

/**
 * Server-side galaxy cache. Each function instance regenerates from the
 * seed on first read (typically 20-50 ms for 12k stars) and then serves
 * the same object for the life of the process.
 *
 * We read the seed and star count from env vars. Changing the seed in a
 * running persistent universe is a world-breaking action — don't.
 */

let cached: Galaxy | null = null;

export function getGalaxy(): Galaxy {
  if (cached) return cached;
  const seed = process.env.GALAXY_SEED ?? "space-bros-prime";
  const starCount = Number.parseInt(process.env.GALAXY_STAR_COUNT ?? "12000", 10);
  cached = generateGalaxy({ seed, starCount });
  return cached;
}

export function getPlanet(starId: number, planetIndex: number) {
  const galaxy = getGalaxy();
  const star = galaxy.stars[starId];
  if (!star) return null;
  const planet = star.planets[planetIndex];
  if (!planet) return null;
  return { star, planet };
}
