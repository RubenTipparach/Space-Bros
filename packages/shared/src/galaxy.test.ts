import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateGalaxy } from "./galaxy.ts";

describe("generateGalaxy", () => {
  it("is deterministic for the same seed", () => {
    const a = generateGalaxy({ seed: 42, starCount: 500 });
    const b = generateGalaxy({ seed: 42, starCount: 500 });
    assert.deepEqual(
      a.stars.slice(0, 5).map((s) => [s.x, s.y, s.z, s.sectorId, s.clusterId, s.groupId]),
      b.stars.slice(0, 5).map((s) => [s.x, s.y, s.z, s.sectorId, s.clusterId, s.groupId]),
    );
    assert.equal(a.sectors.length, b.sectors.length);
    assert.deepEqual(a.sectors.map((s) => s.name), b.sectors.map((s) => s.name));
  });

  it("different seeds produce different galaxies", () => {
    const a = generateGalaxy({ seed: 1, starCount: 200 });
    const b = generateGalaxy({ seed: 2, starCount: 200 });
    assert.notDeepEqual(a.stars[0], b.stars[0]);
  });

  it("produces the requested number of stars", () => {
    const g = generateGalaxy({ seed: "hello", starCount: 1234 });
    assert.equal(g.stars.length, 1234);
  });

  it("every star has group, cluster, and sector assignments", () => {
    const g = generateGalaxy({ seed: "tags", starCount: 800 });
    for (const s of g.stars) {
      assert.ok(s.groupId.length > 0);
      assert.ok(s.clusterId.length > 0);
      assert.ok(s.sectorId.length > 0);
    }
  });

  it("all stars' sector ids match an entry in galaxy.sectors", () => {
    const g = generateGalaxy({ seed: "sector-match", starCount: 600 });
    const sectorIds = new Set(g.sectors.map((s) => s.id));
    for (const s of g.stars) {
      assert.ok(sectorIds.has(s.sectorId), `unknown sector ${s.sectorId}`);
    }
  });

  it("all stars' cluster ids match an entry in galaxy.clusters", () => {
    const g = generateGalaxy({ seed: "cluster-match", starCount: 600 });
    const ids = new Set(g.clusters.map((c) => c.id));
    for (const s of g.stars) {
      assert.ok(ids.has(s.clusterId));
    }
  });

  it("all stars' group ids match an entry in galaxy.groups", () => {
    const g = generateGalaxy({ seed: "group-match", starCount: 600 });
    const ids = new Set(g.groups.map((group) => group.id));
    for (const s of g.stars) {
      assert.ok(ids.has(s.groupId));
    }
  });

  it("each cluster's sector is in galaxy.sectors and each group's cluster is in galaxy.clusters", () => {
    const g = generateGalaxy({ seed: "links", starCount: 600 });
    const sectorIds = new Set(g.sectors.map((s) => s.id));
    const clusterIds = new Set(g.clusters.map((c) => c.id));
    for (const c of g.clusters) assert.ok(sectorIds.has(c.sectorId));
    for (const gr of g.groups) assert.ok(clusterIds.has(gr.clusterId));
  });
});
