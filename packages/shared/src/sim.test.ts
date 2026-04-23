import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accumulatorAt, applyDelta, rebase, setRate } from "./sim.ts";

describe("accumulator", () => {
  it("evaluates value + rate * seconds", () => {
    const acc = { value: 10, rate: 2, t0: 0 };
    assert.equal(accumulatorAt(acc, 5_000), 20);
  });

  it("respects cap", () => {
    const acc = { value: 10, rate: 2, t0: 0, cap: 15 };
    assert.equal(accumulatorAt(acc, 60_000), 15);
  });

  it("rebase preserves current value", () => {
    const acc = { value: 0, rate: 1, t0: 0 };
    const r = rebase(acc, 10_000);
    assert.equal(r.value, 10);
    assert.equal(r.t0, 10_000);
    assert.equal(accumulatorAt(r, 20_000), 20);
  });

  it("applyDelta adds on top of rebased value", () => {
    const acc = { value: 0, rate: 1, t0: 0 };
    const r = applyDelta(acc, 10_000, 5);
    assert.equal(r.value, 15);
  });

  it("setRate preserves accumulated value", () => {
    const acc = { value: 0, rate: 1, t0: 0 };
    const r = setRate(acc, 10_000, 10);
    assert.equal(r.value, 10);
    assert.equal(accumulatorAt(r, 11_000), 20);
  });
});
