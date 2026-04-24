import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateGalaxy } from "./galaxy.ts";

describe("generateGalaxy", () => {
  it("is deterministic for the same seed", () => {
    const a = generateGalaxy({ seed: 42, starCount: 200 });
    const b = generateGalaxy({ seed: 42, starCount: 200 });
    assert.deepEqual(a, b);
  });

  it("produces different galaxies for different seeds", () => {
    const a = generateGalaxy({ seed: 1, starCount: 50 });
    const b = generateGalaxy({ seed: 2, starCount: 50 });
    assert.notDeepEqual(a.stars[0], b.stars[0]);
  });

  it("produces the requested number of stars", () => {
    const g = generateGalaxy({ seed: "hello", starCount: 1234 });
    assert.equal(g.stars.length, 1234);
  });

  it("every star carries a sector + cluster assignment", () => {
    const g = generateGalaxy({ seed: "tags", starCount: 500 });
    for (const s of g.stars) {
      assert.ok(s.sectorId.length > 0, `missing sectorId on star ${s.id}`);
      assert.ok(s.clusterId.length > 0, `missing clusterId on star ${s.id}`);
    }
  });

  it("stars are distributed across all sectors (4 Core quadrants + 6 outer)", () => {
    const g = generateGalaxy({ seed: "distribution", starCount: 8_000 });
    const sectorIds = new Set(g.stars.map((s) => s.sectorId));
    assert.equal(sectorIds.size, 10);
  });

  it("cluster ids on stars match clusters in the galaxy", () => {
    const g = generateGalaxy({ seed: "cid-match", starCount: 200 });
    const clusterIds = new Set(g.clusters.map((c) => c.id));
    for (const s of g.stars) {
      assert.ok(clusterIds.has(s.clusterId), `unknown clusterId ${s.clusterId}`);
    }
  });
});
