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
});
