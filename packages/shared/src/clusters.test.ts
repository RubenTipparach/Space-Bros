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

  it("produces exactly 20 clusters for a 7-sector galaxy", () => {
    const sectors = generateSectors("size");
    const clusters = generateClusters({ seed: "size", sectors, galaxyRadius: 500 });
    assert.equal(clusters.length, 20);
  });

  it("every cluster's code matches the sector prefix + grid", () => {
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
      assert.match(c.name, /^\w+ Cluster \(\w{3}-[A-EC][1-5]\)$/);
    }
  });

  it("Core clusters use letter C", () => {
    const sectors = generateSectors("core-letter");
    const clusters = generateClusters({
      seed: "core-letter",
      sectors,
      galaxyRadius: 500,
    });
    const coreClusters = clusters.filter((c) => c.sectorId === "core");
    assert.ok(coreClusters.length >= 1);
    for (const c of coreClusters) {
      assert.equal(c.grid.letter, "C");
    }
  });
});
