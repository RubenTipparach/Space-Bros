/**
 * Sim primitives for lazy simulation.
 *
 * Core idea: store continuous values as (value, rate, anchor time) and
 * evaluate on read. Discrete transitions live in an event queue keyed by
 * fire_at. The server never "ticks" while idle; a cron drains overdue
 * events and advances accumulators as needed.
 */

export type Millis = number;

export interface Accumulator {
  value: number;
  rate: number;
  t0: Millis;
  cap?: number;
}

export function accumulatorAt(acc: Accumulator, now: Millis): number {
  const elapsedMs = Math.max(0, now - acc.t0);
  const raw = acc.value + acc.rate * (elapsedMs / 1000);
  return acc.cap !== undefined ? Math.min(raw, acc.cap) : raw;
}

export function rebase(acc: Accumulator, now: Millis): Accumulator {
  return { ...acc, value: accumulatorAt(acc, now), t0: now };
}

export function applyDelta(acc: Accumulator, now: Millis, delta: number): Accumulator {
  const based = rebase(acc, now);
  return { ...based, value: based.value + delta };
}

export function setRate(acc: Accumulator, now: Millis, rate: number): Accumulator {
  const based = rebase(acc, now);
  return { ...based, rate };
}

export type EventKind =
  | "fleet_arrive"
  | "research_complete"
  | "terraform_complete"
  | "building_complete"
  | "colony_founded"
  | "combat";

export interface SimEvent<Payload = unknown> {
  id: string;
  kind: EventKind;
  ownerId: string;
  fireAt: Millis;
  payload: Payload;
}

export function compareEvents(a: SimEvent, b: SimEvent): number {
  return a.fireAt - b.fireAt;
}
