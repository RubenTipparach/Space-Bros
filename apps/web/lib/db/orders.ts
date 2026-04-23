import { and, eq } from "drizzle-orm";
import { accumulatorAt, type ResourceCost } from "@space-bros/shared";
import { getDb, schema, type Db } from "./client";

const { playerResources, events, ordersLog } = schema;

/**
 * Shared plumbing for order routes. Each endpoint validates its own
 * semantics (prereqs, one-at-a-time constraints, etc.); the helpers
 * below deal with cross-cutting concerns: idempotency, resource
 * deduction against the caught-up accumulator, and event scheduling.
 *
 * Everything runs inside a single DB transaction so an order either
 * lands completely (log + deduction + event) or not at all.
 */

export class OrderError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "OrderError";
  }
}

export interface IdempotentResult<T> {
  alreadyApplied: boolean;
  result: T;
}

export interface ResourceSnapshot {
  metal: number;
  energy: number;
  science: number;
  metalRate: number;
  energyRate: number;
  scienceRate: number;
  updatedAt: number;
}

export type OrderTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Run `work` inside a transaction that first stamps an `orders_log`
 * row keyed by `orderId`. If a row already exists (the client retried
 * the same order), `work` is skipped and we return the prior insert
 * time so the caller can respond with "already applied."
 */
export async function runIdempotentOrder<T>(
  playerId: string,
  orderId: string,
  kind: string,
  payload: unknown,
  work: (tx: OrderTx) => Promise<T>,
): Promise<IdempotentResult<T | null>> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: ordersLog.id })
      .from(ordersLog)
      .where(eq(ordersLog.id, orderId))
      .limit(1);
    if (existing[0]) {
      return { alreadyApplied: true as const, result: null };
    }

    await tx.insert(ordersLog).values({ id: orderId, playerId, kind, payload });
    const result = await work(tx);
    return { alreadyApplied: false as const, result };
  });
}

export async function loadResources(tx: OrderTx, playerId: string): Promise<ResourceSnapshot> {
  const rows = await tx
    .select()
    .from(playerResources)
    .where(eq(playerResources.playerId, playerId))
    .for("update")
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new OrderError("no_resources", "Player has no resources row. Pick a home planet first.", 409);
  }
  const now = Date.now();
  const metal = accumulatorAt(
    { value: row.metalValue, rate: row.metalRate, t0: row.metalT0 },
    now,
  );
  const energy = accumulatorAt(
    { value: row.energyValue, rate: row.energyRate, t0: row.energyT0 },
    now,
  );
  const science = accumulatorAt(
    { value: row.scienceValue, rate: row.scienceRate, t0: row.scienceT0 },
    now,
  );
  return {
    metal,
    energy,
    science,
    metalRate: row.metalRate,
    energyRate: row.energyRate,
    scienceRate: row.scienceRate,
    updatedAt: now,
  };
}

/**
 * Deduct `cost` from the player's resources. Assumes `loadResources`
 * has already been called in the same transaction so we hold the
 * FOR UPDATE lock. Throws `OrderError("insufficient_resources", ...)`
 * if any line item is short.
 */
export async function deductResources(
  tx: OrderTx,
  playerId: string,
  snapshot: ResourceSnapshot,
  cost: ResourceCost,
): Promise<void> {
  const metalCost = cost.metal ?? 0;
  const energyCost = cost.energy ?? 0;
  const scienceCost = cost.science ?? 0;

  if (
    snapshot.metal < metalCost ||
    snapshot.energy < energyCost ||
    snapshot.science < scienceCost
  ) {
    throw new OrderError(
      "insufficient_resources",
      `Need ${metalCost} metal, ${energyCost} energy, ${scienceCost} science. ` +
        `Have ${Math.floor(snapshot.metal)} / ${Math.floor(snapshot.energy)} / ${Math.floor(snapshot.science)}.`,
      409,
    );
  }

  await tx
    .update(playerResources)
    .set({
      metalValue: snapshot.metal - metalCost,
      metalT0: snapshot.updatedAt,
      energyValue: snapshot.energy - energyCost,
      energyT0: snapshot.updatedAt,
      scienceValue: snapshot.science - scienceCost,
      scienceT0: snapshot.updatedAt,
    })
    .where(eq(playerResources.playerId, playerId));
}

export interface ScheduleEventArgs {
  id: string;
  kind: string;
  payloadVersion?: number;
  ownerId: string;
  fireAt: number;
  payload: unknown;
}

export async function scheduleEvent(tx: OrderTx, args: ScheduleEventArgs): Promise<void> {
  await tx.insert(events).values({
    id: args.id,
    kind: args.kind,
    payloadVersion: args.payloadVersion ?? 1,
    ownerId: args.ownerId,
    fireAt: args.fireAt,
    payload: args.payload,
  });
}

/** Look up the player's single in-flight event of a given kind, if any. */
export async function findPendingEventOfKind(
  tx: OrderTx,
  playerId: string,
  kind: string,
): Promise<{ id: string; fireAt: number; payload: unknown } | null> {
  const rows = await tx
    .select({ id: events.id, fireAt: events.fireAt, payload: events.payload })
    .from(events)
    .where(and(eq(events.ownerId, playerId), eq(events.kind, kind)))
    .limit(1);
  return rows[0] ?? null;
}
