import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CORE_INNER_RADIUS_FRACTION,
  classifyPosition,
  generateSectors,
  wedgeContains,
} from "./sectors.ts";

describe("generateSectors", () => {
  it("returns 1 Core + 6 outer sectors deterministically", () => {
    const a = generateSectors("space-bros-prime");
    const b = generateSectors("space-bros-prime");
    assert.equal(a.length, 7);
    assert.equal(a[0]!.kind, "core");
    assert.equal(a[0]!.name, "The Core");
    assert.deepEqual(
      a.map((s) => s.name),
      b.map((s) => s.name),
    );
  });

  it("different seeds produce different sector sets", () => {
    const a = generateSectors("seed-a");
    const b = generateSectors("seed-b");
    const namesA = a.slice(1).map((s) => s.name).join(",");
    const namesB = b.slice(1).map((s) => s.name).join(",");
    assert.notEqual(namesA, namesB);
  });

  it("outer sectors use unique proper nouns", () => {
    const sectors = generateSectors("unique-check");
    const proper = sectors.slice(1).map((s) => s.name.split(" ")[0]);
    assert.equal(new Set(proper).size, proper.length);
  });

  it("outer wedges tile the full circle", () => {
    const sectors = generateSectors("wedge-sum").slice(1);
    let total = 0;
    for (const s of sectors) {
      const w = s.wedge!;
      const raw = w.end - w.start;
      total += raw >= 0 ? raw : raw + Math.PI * 2;
    }
    assert.ok(Math.abs(total - Math.PI * 2) < 1e-9);
  });
});

describe("wedgeContains", () => {
  it("handles ordinary wedges", () => {
    const w = { start: 0, end: 1 };
    assert.equal(wedgeContains(w, 0.5), true);
    assert.equal(wedgeContains(w, 1), false);
    assert.equal(wedgeContains(w, -0.1), false);
  });
  it("handles wrap-around wedges", () => {
    const w = { start: 5.5, end: 0.5 };
    assert.equal(wedgeContains(w, 6), true);
    assert.equal(wedgeContains(w, 0.2), true);
    assert.equal(wedgeContains(w, 3), false);
  });
});

describe("classifyPosition", () => {
  it("stars near the center fall into Core", () => {
    const sectors = generateSectors("classify");
    const radius = 500;
    const coreR = radius * CORE_INNER_RADIUS_FRACTION * 0.5;
    const s = classifyPosition(coreR, 0, radius, sectors);
    assert.equal(s.kind, "core");
  });
  it("stars outside core land in an outer sector", () => {
    const sectors = generateSectors("classify");
    const radius = 500;
    const s = classifyPosition(radius * 0.8, 0, radius, sectors);
    assert.equal(s.kind, "outer");
  });
});
