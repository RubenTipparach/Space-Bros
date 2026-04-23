import { and, eq } from "drizzle-orm";
import {
  PER_COLONY_RESOURCES,
  accumulatorAt,
  type PerColonyResource,
  type ResourceCost,
} from "@space-bros/shared";
import { getDb, schema, type Db } from "./client";

const { players, colonies, events, ordersLog } = schema;

/**
 * Shared plumbing for order routes. Each endpoint validates its own
 * semantics; the helpers below deal with cross-cutting concerns:
 * idempotency, per-colony resource accounting against the caught-up
 * accumulator, and event scheduling.
 *
 * After ADR-012, costs split into:
 *   - per-colony: metal / food / science / military, locked to a `colonyId`
 *   - global:     credits, locked to a `playerId`
 *
 * `deductCost` does both halves at once so the route handler stays terse.
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

export type OrderTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

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

export interface ColonyResourceSnapshot {
  colonyId: string;
  metal: number;
  food: number;
  science: number;
  military: number;
  /** rates carried so we can rebase accumulators without losing them */
  metalRate: number;
  foodRate: number;
  scienceRate: number;
  militaryRate: number;
  updatedAt: number;
}

export interface CreditsSnapshot {
  credits: number;
  rate: number;
  updatedAt: number;
}

/**
 * FOR UPDATE on the colony row + evaluates each accumulator at `now`.
 * Throws `colony_not_found` if the row is missing.
 */
export async function loadColonyResources(
  tx: OrderTx,
  playerId: string,
  colonyId: string,
): Promise<ColonyResourceSnapshot> {
  const rows = await tx
    .select()
    .from(colonies)
    .where(and(eq(colonies.id, colonyId), eq(colonies.ownerId, playerId)))
    .for("update")
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new OrderError("colony_not_found", `No colony ${colonyId} for this player.`, 404);
  }
  const now = Date.now();
  return {
    colonyId,
    metal: accumulatorAt({ value: row.metalValue, rate: row.metalRate, t0: row.metalT0 }, now),
    food: accumulatorAt({ value: row.foodValue, rate: row.foodRate, t0: row.foodT0 }, now),
    science: accumulatorAt(
      { value: row.scienceValue, rate: row.scienceRate, t0: row.scienceT0 },
      now,
    ),
    military: accumulatorAt(
      { value: row.militaryValue, rate: row.militaryRate, t0: row.militaryT0 },
      now,
    ),
    metalRate: row.metalRate,
    foodRate: row.foodRate,
    scienceRate: row.scienceRate,
    militaryRate: row.militaryRate,
    updatedAt: now,
  };
}

export async function loadCredits(tx: OrderTx, playerId: string): Promise<CreditsSnapshot> {
  const rows = await tx
    .select({
      value: players.creditsValue,
      rate: players.creditsRate,
      t0: players.creditsT0,
    })
    .from(players)
    .where(eq(players.id, playerId))
    .for("update")
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new OrderError("player_not_found", "Player row missing.", 404);
  }
  const now = Date.now();
  return {
    credits: accumulatorAt({ value: row.value, rate: row.rate, t0: row.t0 }, now),
    rate: row.rate,
    updatedAt: now,
  };
}

/**
 * Validate + deduct a `ResourceCost` atomically. Per-colony deductions
 * read the source colony row; global credits deduct from `players`.
 *
 * Pass `colonyId` when the cost has any per-colony component.
 */
export async function deductCost(
  tx: OrderTx,
  playerId: string,
  cost: ResourceCost,
  colonyId: string | null,
): Promise<{ colony: ColonyResourceSnapshot | null; credits: CreditsSnapshot | null }> {
  const hasPerColony = PER_COLONY_RESOURCES.some((k) => (cost[k] ?? 0) > 0);
  const hasCredits = (cost.credits ?? 0) > 0;

  if (hasPerColony && !colonyId) {
    throw new OrderError("colony_required", "This cost needs a source colony.", 400);
  }

  let colonySnap: ColonyResourceSnapshot | null = null;
  if (hasPerColony && colonyId) {
    colonySnap = await loadColonyResources(tx, playerId, colonyId);
    const shortfalls: string[] = [];
    for (const r of PER_COLONY_RESOURCES) {
      const need = cost[r] ?? 0;
      if (need > 0 && colonySnap[r] < need) {
        shortfalls.push(`${need} ${r} (have ${Math.floor(colonySnap[r])})`);
      }
    }
    if (shortfalls.length > 0) {
      throw new OrderError(
        "insufficient_resources",
        `Colony short on: ${shortfalls.join(", ")}.`,
        409,
      );
    }
    await tx
      .update(colonies)
      .set(buildColonyDeductionPatch(colonySnap, cost))
      .where(eq(colonies.id, colonyId));
  }

  let creditsSnap: CreditsSnapshot | null = null;
  if (hasCredits) {
    creditsSnap = await loadCredits(tx, playerId);
    const need = cost.credits ?? 0;
    if (creditsSnap.credits < need) {
      throw new OrderError(
        "insufficient_credits",
        `Need ${need} credits (have ${Math.floor(creditsSnap.credits)}).`,
        409,
      );
    }
    await tx
      .update(players)
      .set({
        creditsValue: creditsSnap.credits - need,
        creditsT0: creditsSnap.updatedAt,
      })
      .where(eq(players.id, playerId));
  }

  return { colony: colonySnap, credits: creditsSnap };
}

function buildColonyDeductionPatch(
  snap: ColonyResourceSnapshot,
  cost: ResourceCost,
): Partial<typeof colonies.$inferInsert> {
  const patch: Partial<typeof colonies.$inferInsert> = {};
  for (const r of PER_COLONY_RESOURCES) {
    const need = cost[r] ?? 0;
    if (need <= 0) continue;
    const valueKey = `${r}Value` as `${PerColonyResource}Value`;
    const t0Key = `${r}T0` as `${PerColonyResource}T0`;
    (patch as Record<string, unknown>)[valueKey] = snap[r] - need;
    (patch as Record<string, unknown>)[t0Key] = snap.updatedAt;
  }
  return patch;
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
