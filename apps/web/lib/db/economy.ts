import { eq } from "drizzle-orm";
import {
  accumulatorAt,
  colonyTargetRates,
  effectivePopulationRate,
  globalCreditsRate,
  populationCap,
  type Biome,
} from "@space-bros/shared";
import { schema } from "./client";
import type { TickTx } from "./tick";

const { players, colonies, research } = schema;

/**
 * Re-derive every per-colony rate + the global credits rate from the
 * authoritative state (buildings, research, biome). Called whenever a
 * building completes or a tech that affects rates lands.
 *
 * Algorithm:
 *   1. Lock the player row (FOR UPDATE).
 *   2. Load all of the player's colonies + completed techs.
 *   3. For each colony: compute target rates + cap, rebase its
 *      accumulators to `now`, write the new (value, rate, t0).
 *   4. Sum every colony's credits contribution + the home baseline,
 *      rebase the player's credits accumulator, write the new rate.
 *
 * Pure function of the persisted state; idempotent if called twice in
 * a row with the same `now`.
 */
export async function recomputePlayerEconomy(
  tx: TickTx,
  playerId: string,
  now: number,
): Promise<void> {
  const playerRows = await tx
    .select()
    .from(players)
    .where(eq(players.id, playerId))
    .for("update")
    .limit(1);
  const player = playerRows[0];
  if (!player) return;

  const techRows = await tx
    .select({ techId: research.techId })
    .from(research)
    .where(eq(research.playerId, playerId));
  const techSet = new Set(techRows.map((r) => r.techId));

  const colonyRows = await tx.select().from(colonies).where(eq(colonies.ownerId, playerId));

  const contributions: number[] = [];

  for (const c of colonyRows) {
    const isHome = c.id === player.homeColonyId;
    const target = colonyTargetRates(c.buildings, isHome);
    contributions.push(target.creditsContribution);

    const habitabilityFromBiome = biomeHabitabilityForGrowth(c.biome as Biome);
    const popNow = accumulatorAt(
      { value: c.populationValue, rate: c.populationRate, t0: c.populationT0 },
      now,
    );
    const newPopRate = effectivePopulationRate({
      population: popNow,
      habitability: habitabilityFromBiome,
      foodProducedPerSec: target.food,
    });
    const cap = populationCap(c.biome as Biome, c.buildings, techSet);

    await tx
      .update(colonies)
      .set({
        metalValue: accumulatorAt(
          { value: c.metalValue, rate: c.metalRate, t0: c.metalT0 },
          now,
        ),
        metalRate: target.metal,
        metalT0: now,
        foodValue: accumulatorAt(
          { value: c.foodValue, rate: c.foodRate, t0: c.foodT0 },
          now,
        ),
        foodRate: target.food,
        foodT0: now,
        scienceValue: accumulatorAt(
          { value: c.scienceValue, rate: c.scienceRate, t0: c.scienceT0 },
          now,
        ),
        scienceRate: target.science,
        scienceT0: now,
        militaryValue: accumulatorAt(
          { value: c.militaryValue, rate: c.militaryRate, t0: c.militaryT0 },
          now,
        ),
        militaryRate: target.military,
        militaryT0: now,
        populationValue: Math.min(popNow, cap),
        populationRate: newPopRate,
        populationT0: now,
        populationCap: cap,
      })
      .where(eq(colonies.id, c.id));
  }

  const totalCreditsRate = globalCreditsRate(contributions, Boolean(player.homeColonyId));
  const creditsNow = accumulatorAt(
    { value: player.creditsValue, rate: player.creditsRate, t0: player.creditsT0 },
    now,
  );
  await tx
    .update(players)
    .set({
      creditsValue: creditsNow,
      creditsRate: totalCreditsRate,
      creditsT0: now,
    })
    .where(eq(players.id, playerId));
}

/**
 * The galaxy generator picks habitabilities per planet, but on the colony
 * row we only persist `biome`. For the food-gating math we approximate
 * habitability from the biome — the value is intentionally rough; once
 * a colony exists, biome is what matters for the growth-rate gate.
 *
 * Earthlike here is intentionally < 1.0 because the planet generator
 * tops out around 0.95 with random jitter; using 0.85 keeps the math
 * in the same ballpark as the live galaxy data.
 */
const BIOME_HABITABILITY_FOR_GROWTH: Record<Biome, number> = {
  earthlike: 0.85,
  jungle: 0.65,
  ocean: 0.5,
  tundra: 0.32,
  desert: 0.28,
  rocky: 0.12,
  ice: 0.12,
  toxic: 0.06,
  molten: 0,
  gas: 0,
};

function biomeHabitabilityForGrowth(biome: Biome): number {
  return BIOME_HABITABILITY_FOR_GROWTH[biome] ?? 0;
}
