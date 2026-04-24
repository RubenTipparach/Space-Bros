import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHierarchy } from "./hierarchy.ts";

function makeStars(seed: number, count: number): { x: number; z: number }[] {
  // Pseudo-spiral for test stability — not quite the full generator
  // but gives a spread-out set of points that avoids pathological
  // k-means degenerate cases.
  let s = seed >>> 0;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rng()) * 500;
    const theta = rng() * Math.PI * 2;
    out.push({ x: Math.cos(theta) * r, z: Math.sin(theta) * r });
  }
  return out;
}

describe("buildHierarchy", () => {
  it("is deterministic for the same seed + stars", () => {
    const stars = makeStars(42, 1500);
    const a = buildHierarchy({ seed: "x", stars, galaxyRadius: 500 });
    const b = buildHierarchy({ seed: "x", stars, galaxyRadius: 500 });
    assert.deepEqual(a.starGroupIds, b.starGroupIds);
    assert.deepEqual(a.starClusterIds, b.starClusterIds);
    assert.deepEqual(a.starSectorIds, b.starSectorIds);
    assert.deepEqual(
      a.sectors.map((s) => s.name),
      b.sectors.map((s) => s.name),
    );
  });

  it("produces the requested sector count (or fewer if inputs are small)", () => {
    const stars = makeStars(1, 1200);
    const h = buildHierarchy({
      seed: 1,
      stars,
      galaxyRadius: 500,
      sectorCount: 8,
    });
    assert.equal(h.sectors.length, 8);
  });

  it("every star lands in exactly one group + cluster + sector", () => {
    const stars = makeStars(3, 1500);
    const h = buildHierarchy({ seed: "hier", stars, galaxyRadius: 500 });
    assert.equal(h.starGroupIds.length, stars.length);
    assert.equal(h.starClusterIds.length, stars.length);
    assert.equal(h.starSectorIds.length, stars.length);
    const groupIds = new Set(h.groups.map((g) => g.id));
    const clusterIds = new Set(h.clusters.map((c) => c.id));
    const sectorIds = new Set(h.sectors.map((s) => s.id));
    for (let i = 0; i < stars.length; i++) {
      assert.ok(groupIds.has(h.starGroupIds[i]!));
      assert.ok(clusterIds.has(h.starClusterIds[i]!));
      assert.ok(sectorIds.has(h.starSectorIds[i]!));
    }
  });

  it("cluster / sector membership is consistent (cluster.sectorId exists, group.clusterId exists)", () => {
    const h = buildHierarchy({
      seed: "consistency",
      stars: makeStars(5, 1200),
      galaxyRadius: 500,
    });
    const sectorById = new Map(h.sectors.map((s) => [s.id, s]));
    const clusterById = new Map(h.clusters.map((c) => [c.id, c]));
    for (const c of h.clusters) {
      assert.ok(sectorById.has(c.sectorId), `cluster ${c.id} → unknown sector`);
    }
    for (const g of h.groups) {
      assert.ok(clusterById.has(g.clusterId), `group ${g.id} → unknown cluster`);
    }
  });

  it("cluster.groupIds and sector.clusterIds round-trip", () => {
    const h = buildHierarchy({
      seed: "roundtrip",
      stars: makeStars(7, 1200),
      galaxyRadius: 500,
    });
    for (const c of h.clusters) {
      for (const gid of c.groupIds) {
        const g = h.groups.find((x) => x.id === gid)!;
        assert.equal(g.clusterId, c.id);
      }
    }
    for (const s of h.sectors) {
      for (const cid of s.clusterIds) {
        const c = h.clusters.find((x) => x.id === cid)!;
        assert.equal(c.sectorId, s.id);
      }
    }
  });

  it("sector names come from the dictionary and are unique per galaxy", () => {
    const h = buildHierarchy({
      seed: "names",
      stars: makeStars(11, 1200),
      galaxyRadius: 500,
    });
    const names = h.sectors.map((s) => s.name);
    assert.equal(new Set(names).size, names.length);
    for (const n of names) {
      assert.match(n, /^\w+ \w+$/);
    }
  });

  it("group polygons are closed polygons (or null for clipped cells)", () => {
    const h = buildHierarchy({
      seed: "polys",
      stars: makeStars(13, 1500),
      galaxyRadius: 500,
    });
    let nullCount = 0;
    for (const g of h.groups) {
      if (g.polygon === null) {
        nullCount++;
        continue;
      }
      assert.ok(g.polygon.length >= 3, `group ${g.id} polygon too small`);
    }
    // A handful of cells can be clipped empty near the bbox corners,
    // but the vast majority must be solid polygons.
    assert.ok(nullCount < h.groups.length * 0.05);
  });
});
