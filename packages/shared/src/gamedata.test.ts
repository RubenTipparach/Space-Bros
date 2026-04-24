import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BIOME_BASE_POPULATION,
  BUILDINGS,
  buildingTierKey,
  colonyTargetRates,
  distinctBuildingTypes,
  effectivePopulationRate,
  globalCreditsRate,
  habitatTechMultiplier,
  HOME_COLONY_RESOURCE_RATES,
  parseBuildingKey,
  populationCap,
  varietyMultiplier,
} from "./gamedata.ts";

describe("buildingTierKey / parseBuildingKey", () => {
  it("round-trips", () => {
    assert.equal(buildingTierKey("mine", 1), "mine_1");
    assert.deepEqual(parseBuildingKey("mine_1"), { type: "mine", tier: 1 });
    assert.deepEqual(parseBuildingKey("trade_hub_3"), { type: "trade_hub", tier: 3 });
  });
  it("rejects garbage", () => {
    assert.equal(parseBuildingKey("foo"), null);
    assert.equal(parseBuildingKey("mine_x"), null);
    assert.equal(parseBuildingKey("not_a_thing_2"), null);
  });
});

describe("varietyMultiplier", () => {
  it("0 or 1 type → 0.5×", () => {
    assert.equal(varietyMultiplier({}), 0.5);
    assert.equal(varietyMultiplier({ mine_1: 5 }), 0.5);
  });
  it("2 types → 1.0×", () => {
    assert.equal(varietyMultiplier({ mine_1: 1, farm_1: 1 }), 1.0);
  });
  it("scales up to 2.0× at all 5 types", () => {
    const all = {
      mine_1: 1,
      farm_1: 1,
      trade_hub_1: 1,
      lab_1: 1,
      barracks_1: 1,
    };
    assert.equal(varietyMultiplier(all), 2.0);
  });
  it("multiple tiers of one type still count as one type", () => {
    assert.equal(distinctBuildingTypes({ mine_1: 3, mine_2: 2 }), 1);
  });
  it("ignores zero counts", () => {
    assert.equal(distinctBuildingTypes({ mine_1: 0, farm_1: 1 }), 1);
  });
});

describe("populationCap", () => {
  it("earthlike with no buildings uses biome base × variety×0.5", () => {
    const cap = populationCap("earthlike", {}, new Set());
    assert.equal(cap, Math.round(BIOME_BASE_POPULATION.earthlike! * 0.5));
  });
  it("earthlike with full variety doubles base", () => {
    const all = {
      mine_1: 1,
      farm_1: 1,
      trade_hub_1: 1,
      lab_1: 1,
      barracks_1: 1,
    };
    const cap = populationCap("earthlike", all, new Set());
    assert.equal(cap, Math.round(BIOME_BASE_POPULATION.earthlike! * 2.0));
  });
  it("habitat tech picks the highest unlocked, not stacking", () => {
    assert.equal(habitatTechMultiplier(new Set(["better_habitats"])), 1.5);
    assert.equal(
      habitatTechMultiplier(new Set(["better_habitats", "arcologies"])),
      2.5,
    );
    assert.equal(
      habitatTechMultiplier(new Set(["megacities", "better_habitats"])),
      5.0,
    );
  });
});

describe("effectivePopulationRate", () => {
  it("zero on uninhabitable", () => {
    assert.equal(
      effectivePopulationRate({ population: 1000, habitability: 0.1, foodProducedPerSec: 99 }),
      0,
    );
  });
  it("starvation halts growth", () => {
    const rate = effectivePopulationRate({
      population: 100_000,
      habitability: 0.9,
      foodProducedPerSec: 0,
    });
    assert.equal(rate, 0);
  });
  it("surplus food bonuses up to 1.5×", () => {
    const need = 10_000 / 10_000; // 1 food/s
    const baseAtFull = 0.05 * 0.9; // 0.045
    const bonusedRate = effectivePopulationRate({
      population: 10_000,
      habitability: 0.9,
      foodProducedPerSec: need * 5, // way more than 1.5×
    });
    assert.equal(bonusedRate, baseAtFull * 1.5);
  });
  it("matches base rate when food is exactly sufficient", () => {
    const rate = effectivePopulationRate({
      population: 10_000,
      habitability: 0.9,
      foodProducedPerSec: 1, // = pop / 10k
    });
    assert.equal(rate, 0.05 * 0.9);
  });
});

describe("colonyTargetRates", () => {
  it("home with no buildings returns the §5.2 baseline", () => {
    const r = colonyTargetRates({}, true);
    assert.equal(r.metal, HOME_COLONY_RESOURCE_RATES.metalPerSecond);
    assert.equal(r.food, HOME_COLONY_RESOURCE_RATES.foodPerSecond);
    assert.equal(r.science, HOME_COLONY_RESOURCE_RATES.sciencePerSecond);
    assert.equal(r.military, HOME_COLONY_RESOURCE_RATES.militaryPerSecond);
    assert.equal(r.creditsContribution, 0); // baseline credits is global, not from a colony
  });
  it("outpost with no buildings is fully zero", () => {
    const r = colonyTargetRates({}, false);
    assert.equal(r.metal, 0);
    assert.equal(r.food, 0);
    assert.equal(r.science, 0);
    assert.equal(r.military, 0);
    assert.equal(r.creditsContribution, 0);
  });
  it("a single Tier-1 mine adds the right metal rate", () => {
    const r = colonyTargetRates({ mine_1: 1 }, false);
    assert.equal(r.metal, BUILDINGS.mine.tiers[0]!.perSecond);
  });
  it("multiple buildings sum", () => {
    const r = colonyTargetRates({ mine_1: 3, mine_2: 1 }, false);
    const expected = BUILDINGS.mine.tiers[0]!.perSecond * 3 + BUILDINGS.mine.tiers[1]!.perSecond;
    assert.equal(r.metal, expected);
  });
  it("trade hub credits multiplied by colony variety", () => {
    // 5 types → variety 2.0
    const buildings = {
      mine_1: 1,
      farm_1: 1,
      trade_hub_1: 1,
      lab_1: 1,
      barracks_1: 1,
    };
    const r = colonyTargetRates(buildings, false);
    const tradeBase = BUILDINGS.trade_hub.tiers[0]!.perSecond;
    assert.equal(r.creditsContribution, tradeBase * 2.0);
  });
});

describe("globalCreditsRate", () => {
  it("includes the home baseline trickle", () => {
    assert.equal(globalCreditsRate([], true), HOME_COLONY_RESOURCE_RATES.creditsPerSecond);
  });
  it("zero without home", () => {
    assert.equal(globalCreditsRate([], false), 0);
  });
  it("sums all per-colony contributions", () => {
    const actual = globalCreditsRate([0.1, 0.2, 0.3], true);
    const expected = HOME_COLONY_RESOURCE_RATES.creditsPerSecond + 0.6;
    assert.ok(Math.abs(actual - expected) < 1e-9, `expected ~${expected}, got ${actual}`);
  });
});
