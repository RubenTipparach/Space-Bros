import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPlayerState } from "./state.ts";
import { advanceTo, processEvent } from "./events.ts";
import type { SimEvent } from "./sim.ts";
import type {
  ResearchCompletePayload,
  ColonyFoundedPayload,
  BuildingCompletePayload,
} from "./events.ts";
import { accumulatorAt } from "./sim.ts";

function event<P>(partial: Omit<SimEvent<P>, "id"> & { id?: string }): SimEvent<P> {
  return { id: partial.id ?? `evt-${partial.kind}-${partial.fireAt}`, ...partial };
}

describe("processEvent: research_complete", () => {
  it("adds the tech to the player's research set", () => {
    const s = createPlayerState("p1", 0);
    const e = event<ResearchCompletePayload>({
      kind: "research_complete",
      ownerId: "p1",
      fireAt: 1_000,
      payload: { techId: "faster_ships_1" },
    });
    const { state } = processEvent(s, e);
    assert.equal(state.research.has("faster_ships_1"), true);
    assert.equal(state.now, 1_000);
  });

  it("is idempotent when replayed", () => {
    const s = createPlayerState("p1", 0);
    const e = event<ResearchCompletePayload>({
      kind: "research_complete",
      ownerId: "p1",
      fireAt: 1_000,
      payload: { techId: "faster_ships_1" },
    });
    const once = processEvent(s, e).state;
    const twice = processEvent(once, e).state;
    assert.deepEqual([...twice.research].sort(), [...once.research].sort());
  });
});

describe("processEvent: colony_founded", () => {
  it("creates a new colony and removes the arriving fleet", () => {
    const s0 = createPlayerState("p1", 0);
    const s = {
      ...s0,
      fleets: {
        "f1": {
          id: "f1",
          ownerId: "p1",
          ships: { colony_ship: 1 },
          fromStarId: 0,
          toStarId: 42,
          departAt: 0,
          arriveAt: 5_000,
        },
      },
    };
    const e = event<ColonyFoundedPayload>({
      kind: "colony_founded",
      ownerId: "p1",
      fireAt: 5_000,
      payload: {
        fleetId: "f1",
        planetId: "42:1",
        biome: "earthlike",
        colonists: 1_000,
      },
    });
    const { state } = processEvent(s, e);
    assert.equal(Object.keys(state.colonies).length, 1);
    assert.equal(state.homeColonyId, "p1:42:1");
    assert.equal(state.colonies["p1:42:1"]!.population.value, 1_000);
    assert.equal(state.fleets["f1"], undefined);
  });

  it("reinforces an existing colony instead of creating a new one", () => {
    const s0 = createPlayerState("p1", 0);
    const colonyId = "p1:42:1";
    const s = {
      ...s0,
      homeColonyId: colonyId,
      colonies: {
        [colonyId]: {
          id: colonyId,
          planetId: "42:1",
          ownerId: "p1",
          foundedAt: 0,
          biome: "earthlike" as const,
          buildings: {},
          population: { value: 500, rate: 1, t0: 0 },
        },
      },
      fleets: {
        "f2": {
          id: "f2",
          ownerId: "p1",
          ships: { colony_ship: 1 },
          fromStarId: 0,
          toStarId: 42,
          departAt: 0,
          arriveAt: 10_000,
        },
      },
    };
    const e = event<ColonyFoundedPayload>({
      kind: "colony_founded",
      ownerId: "p1",
      fireAt: 10_000,
      payload: {
        fleetId: "f2",
        planetId: "42:1",
        biome: "earthlike",
        colonists: 200,
      },
    });
    const { state } = processEvent(s, e);
    // 500 (initial) + 1 pop/s * 10 s (elapsed) + 200 (new colonists) = 710
    assert.equal(state.colonies[colonyId]!.population.value, 710);
    assert.equal(Object.keys(state.colonies).length, 1);
  });
});

describe("advanceTo", () => {
  it("processes events in fireAt order up to now", () => {
    const s0 = createPlayerState("p1", 0);
    const e1 = event<ResearchCompletePayload>({
      kind: "research_complete",
      ownerId: "p1",
      fireAt: 2_000,
      payload: { techId: "a" },
    });
    const e2 = event<ResearchCompletePayload>({
      kind: "research_complete",
      ownerId: "p1",
      fireAt: 5_000,
      payload: { techId: "b" },
    });
    const e3 = event<ResearchCompletePayload>({
      kind: "research_complete",
      ownerId: "p1",
      fireAt: 9_000,
      payload: { techId: "c" },
    });
    const s = { ...s0, pendingEvents: [e3, e1, e2] };
    const { state, consumed } = advanceTo(s, 6_000);
    assert.deepEqual(
      [...state.research].sort(),
      ["a", "b"],
    );
    assert.deepEqual(consumed.map((e) => e.id), [e1.id, e2.id]);
    assert.equal(state.pendingEvents.length, 1);
    assert.equal(state.pendingEvents[0]!.id, e3.id);
    assert.equal(state.now, 6_000);
  });

  it("leaves state untouched when no events are due", () => {
    const s0 = createPlayerState("p1", 0);
    const e1 = event<ResearchCompletePayload>({
      kind: "research_complete",
      ownerId: "p1",
      fireAt: 1_000_000,
      payload: { techId: "a" },
    });
    const s = { ...s0, pendingEvents: [e1] };
    const { state, consumed } = advanceTo(s, 100);
    assert.equal(consumed.length, 0);
    assert.equal(state.pendingEvents.length, 1);
    assert.equal(state.now, 100);
  });
});

describe("processEvent: building_complete", () => {
  it("increments the building level", () => {
    const s0 = createPlayerState("p1", 0);
    const colonyId = "p1:7:0";
    const s = {
      ...s0,
      colonies: {
        [colonyId]: {
          id: colonyId,
          planetId: "7:0",
          ownerId: "p1",
          foundedAt: 0,
          biome: "rocky" as const,
          buildings: { mine: 1 },
          population: { value: 100, rate: 0, t0: 0 },
        },
      },
    };
    const e = event<BuildingCompletePayload>({
      kind: "building_complete",
      ownerId: "p1",
      fireAt: 3_000,
      payload: { colonyId, buildingId: "mine" },
    });
    const { state } = processEvent(s, e);
    assert.equal(state.colonies[colonyId]!.buildings["mine"], 2);
  });
});

describe("accumulator evaluation during advanceTo", () => {
  it("accumulators can be read at the advanced `now`", () => {
    const s0 = createPlayerState("p1", 0);
    const s = {
      ...s0,
      resources: {
        ...s0.resources,
        metal: { value: 0, rate: 2, t0: 0 },
      },
    };
    const { state } = advanceTo(s, 10_000);
    assert.equal(accumulatorAt(state.resources.metal, state.now), 20);
  });
});
