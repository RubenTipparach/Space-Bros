import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CORE_INNER_RADIUS_FRACTION,
  CORE_QUADRANT_COUNT,
  OUTER_SECTOR_COUNT,
  classifyPosition,
  generateSectors,
  wedgeContains,
  wedgeLength,
} from "./sectors.ts";

describe("generateSectors", () => {
  it("returns 4 Core quadrants + 6 outer sectors deterministically", () => {
    const a = generateSectors("space-bros-prime");
    const b = generateSectors("space-bros-prime");
    assert.equal(a.length, CORE_QUADRANT_COUNT + OUTER_SECTOR_COUNT);
    const coreCount = a.filter((s) => s.kind === "core").length;
    const outerCount = a.filter((s) => s.kind === "outer").length;
    assert.equal(coreCount, CORE_QUADRANT_COUNT);
    assert.equal(outerCount, OUTER_SECTOR_COUNT);
    assert.deepEqual(a.map((s) => s.name), b.map((s) => s.name));
  });

  it("Core quadrants are named North/East/South/West", () => {
    const a = generateSectors("x");
    const coreNames = a.filter((s) => s.kind === "core").map((s) => s.name);
    assert.deepEqual(coreNames, [
      "Core North",
      "Core East",
      "Core South",
      "Core West",
    ]);
  });

  it("different seeds produce different outer sector sets", () => {
    const a = generateSectors("seed-a").filter((s) => s.kind === "outer");
    const b = generateSectors("seed-b").filter((s) => s.kind === "outer");
    const namesA = a.map((s) => s.name).join(",");
    const namesB = b.map((s) => s.name).join(",");
    assert.notEqual(namesA, namesB);
  });

  it("outer sectors use unique proper nouns", () => {
    const outer = generateSectors("unique-check").filter((s) => s.kind === "outer");
    const proper = outer.map((s) => s.name.split(" ")[0]);
    assert.equal(new Set(proper).size, proper.length);
  });

  it("Core quadrants tile 2π exactly; outer wedges tile 2π exactly", () => {
    const sectors = generateSectors("tile");
    let coreTotal = 0;
    let outerTotal = 0;
    for (const s of sectors) {
      if (s.kind === "core") coreTotal += wedgeLength(s.wedge);
      else outerTotal += wedgeLength(s.wedge);
    }
    assert.ok(Math.abs(coreTotal - Math.PI * 2) < 1e-9);
    assert.ok(Math.abs(outerTotal - Math.PI * 2) < 1e-9);
  });

  it("sector innerR/outerR match kind", () => {
    const sectors = generateSectors("bounds");
    for (const s of sectors) {
      if (s.kind === "core") {
        assert.equal(s.innerR, 0);
        assert.equal(s.outerR, CORE_INNER_RADIUS_FRACTION);
      } else {
        assert.equal(s.innerR, CORE_INNER_RADIUS_FRACTION);
        assert.equal(s.outerR, 1);
      }
    }
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
  it("stars near the center fall into a Core quadrant", () => {
    const sectors = generateSectors("classify");
    const radius = 500;
    const coreR = radius * CORE_INNER_RADIUS_FRACTION * 0.5;
    // Sample every 30° and make sure classification picks a core sector.
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const x = Math.cos(a) * coreR;
      const z = Math.sin(a) * coreR;
      const s = classifyPosition(x, z, radius, sectors);
      assert.equal(s.kind, "core", `angle ${a} fell outside Core`);
    }
  });
  it("stars outside core land in an outer sector", () => {
    const sectors = generateSectors("classify");
    const radius = 500;
    const s = classifyPosition(radius * 0.8, 0, radius, sectors);
    assert.equal(s.kind, "outer");
  });
});
