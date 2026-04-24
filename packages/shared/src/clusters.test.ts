import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateClusters } from "./clusters.ts";
import { generateSectors } from "./sectors.ts";

describe("generateClusters", () => {
  it("is deterministic", () => {
    const sectors = generateSectors("det");
    const a = generateClusters({ seed: "det", sectors, galaxyRadius: 500 });
    const b = generateClusters({ seed: "det", sectors, galaxyRadius: 500 });
    assert.deepEqual(
      a.map((c) => c.code + "/" + c.name),
      b.map((c) => c.code + "/" + c.name),
    );
  });

  it("produces exactly 26 clusters: 2 per core × 4 + 3 per outer × 6", () => {
    const sectors = generateSectors("size");
    const clusters = generateClusters({ seed: "size", sectors, galaxyRadius: 500 });
    assert.equal(clusters.length, 2 * 4 + 3 * 6);
    const coreClusters = clusters.filter(
      (c) => sectors.find((s) => s.id === c.sectorId)?.kind === "core",
    );
    const outerClusters = clusters.filter(
      (c) => sectors.find((s) => s.id === c.sectorId)?.kind === "outer",
    );
    assert.equal(coreClusters.length, 8);
    assert.equal(outerClusters.length, 18);
  });

  it("every cluster's code matches the sector prefix + grid cell", () => {
    const sectors = generateSectors("code");
    const clusters = generateClusters({ seed: "code", sectors, galaxyRadius: 500 });
    for (const c of clusters) {
      const sector = sectors.find((s) => s.id === c.sectorId)!;
      assert.equal(c.code.split("-")[0], sector.prefix);
      assert.equal(c.code.split("-")[1], `${c.grid.letter}${c.grid.band}`);
    }
  });

  it("display name has fancy name + parenthesized code", () => {
    const sectors = generateSectors("dn");
    const clusters = generateClusters({ seed: "dn", sectors, galaxyRadius: 500 });
    for (const c of clusters) {
      // Core prefixes are 2 letters (CN, CE, CS, CW); outer prefixes are 3.
      assert.match(c.name, /^\w+ Cluster \(\w{2,3}-[A-E][1-5]\)$/);
    }
  });

  it("Core clusters use letters A or B and bands 1 or 2", () => {
    const sectors = generateSectors("core-grid");
    const clusters = generateClusters({
      seed: "core-grid",
      sectors,
      galaxyRadius: 500,
    });
    const core = clusters.filter(
      (c) => sectors.find((s) => s.id === c.sectorId)?.kind === "core",
    );
    assert.ok(core.length > 0);
    for (const c of core) {
      assert.ok(c.grid.letter === "A" || c.grid.letter === "B");
      assert.ok(c.grid.band === 1 || c.grid.band === 2);
    }
  });
});
