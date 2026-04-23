import { and, eq, inArray, sql } from "drizzle-orm";
import type { Biome } from "@space-bros/shared";
import { schema, type Db } from "./client";

const { events, research, colonies, fleets, players, planetOverlays } = schema;

/**
 * The DB applier for sim events. The pure in-memory reducer lives in
 * `@space-bros/shared/events` — this file is its database mirror. When
 * you add a new event kind, update both.
 *
 * Each applier runs inside the caller's transaction and does the minimal
 * write for that event kind. Emitting follow-up events is done by
 * returning them as rows to INSERT; the drain loop persists them.
 */

export type TickTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface EventRow {
  id: string;
  kind: string;
  payloadVersion: number;
  ownerId: string;
  fireAt: number;
  payload: unknown;
}

export interface FollowUpEvent {
  id: string;
  kind: string;
  payloadVersion: number;
  ownerId: string;
  fireAt: number;
  payload: unknown;
}

export interface ApplyResult {
  followUps: FollowUpEvent[];
  affectedOwnerIds: string[];
}

interface ResearchCompletePayload {
  techId: string;
}
interface BuildingCompletePayload {
  colonyId: string;
  buildingId: string;
}
interface TerraformCompletePayload {
  colonyId: string;
  targetBiome: Biome;
}
interface FleetArrivePayload {
  fleetId: string;
}
interface ColonyFoundedPayload {
  fleetId: string;
  planetId: string;
  biome: Biome;
  colonists: number;
}

/**
 * Apply a single event to the DB. Throws if the payload shape doesn't
 * match the declared kind/payload_version, because that's a bug in the
 * scheduler, not a recoverable runtime condition.
 */
export async function applyEvent(tx: TickTx, event: EventRow): Promise<ApplyResult> {
  const affected = [event.ownerId];
  switch (event.kind) {
    case "research_complete":
      await applyResearchComplete(tx, event);
      return { followUps: [], affectedOwnerIds: affected };
    case "building_complete":
      await applyBuildingComplete(tx, event);
      return { followUps: [], affectedOwnerIds: affected };
    case "terraform_complete":
      await applyTerraformComplete(tx, event);
      return { followUps: [], affectedOwnerIds: affected };
    case "fleet_arrive":
      await applyFleetArrive(tx, event);
      return { followUps: [], affectedOwnerIds: affected };
    case "colony_founded":
      await applyColonyFounded(tx, event);
      return { followUps: [], affectedOwnerIds: affected };
    case "combat":
      // Chunk 10: seeded-RNG combat resolver lives here.
      return { followUps: [], affectedOwnerIds: affected };
    default:
      throw new Error(`unknown event kind: ${event.kind}`);
  }
}

async function applyResearchComplete(tx: TickTx, event: EventRow) {
  const p = event.payload as ResearchCompletePayload;
  await tx
    .insert(research)
    .values({ playerId: event.ownerId, techId: p.techId })
    .onConflictDoNothing();
}

async function applyBuildingComplete(tx: TickTx, event: EventRow) {
  const p = event.payload as BuildingCompletePayload;
  await tx
    .update(colonies)
    .set({
      buildings: sql`jsonb_set(
        coalesce(${colonies.buildings}, '{}'::jsonb),
        ${`{${p.buildingId}}`}::text[],
        to_jsonb(coalesce((${colonies.buildings}->>${p.buildingId})::int, 0) + 1)
      )`,
    })
    .where(and(eq(colonies.id, p.colonyId), eq(colonies.ownerId, event.ownerId)));
}

async function applyTerraformComplete(tx: TickTx, event: EventRow) {
  const p = event.payload as TerraformCompletePayload;
  await tx
    .update(colonies)
    .set({ biome: p.targetBiome })
    .where(and(eq(colonies.id, p.colonyId), eq(colonies.ownerId, event.ownerId)));

  // Pin the overlay so fresh readers see the terraformed biome even
  // before their colony is loaded.
  const colonyRow = await tx
    .select({ planetId: colonies.planetId })
    .from(colonies)
    .where(eq(colonies.id, p.colonyId))
    .limit(1);
  const planetId = colonyRow[0]?.planetId;
  if (planetId) {
    await tx
      .insert(planetOverlays)
      .values({ planetId, biome: p.targetBiome })
      .onConflictDoUpdate({
        target: planetOverlays.planetId,
        set: { biome: p.targetBiome },
      });
  }
}

async function applyFleetArrive(tx: TickTx, event: EventRow) {
  const p = event.payload as FleetArrivePayload;
  await tx.delete(fleets).where(and(eq(fleets.id, p.fleetId), eq(fleets.ownerId, event.ownerId)));
}

async function applyColonyFounded(tx: TickTx, event: EventRow) {
  const p = event.payload as ColonyFoundedPayload;
  const colonyId = `${event.ownerId}:${p.planetId}`;
  const now = event.fireAt;

  const existing = await tx
    .select()
    .from(colonies)
    .where(eq(colonies.id, colonyId))
    .for("update")
    .limit(1);

  if (existing[0]) {
    // Reinforcement: rebase population to `now` and add colonists.
    const col = existing[0];
    const elapsedSeconds = Math.max(0, now - col.populationT0) / 1000;
    const current = col.populationValue + col.populationRate * elapsedSeconds;
    await tx
      .update(colonies)
      .set({
        populationValue: current + p.colonists,
        populationT0: now,
      })
      .where(eq(colonies.id, colonyId));
  } else {
    // New outpost — zero rates everywhere; SP-1b's buildings light it up.
    await tx.insert(colonies).values({
      id: colonyId,
      ownerId: event.ownerId,
      planetId: p.planetId,
      biome: p.biome,
      foundedAt: now,
      populationValue: p.colonists,
      populationRate: 0,
      populationT0: now,
      metalT0: now,
      foodT0: now,
      scienceT0: now,
      militaryT0: now,
    });

    const player = await tx
      .select({ homeColonyId: players.homeColonyId })
      .from(players)
      .where(eq(players.id, event.ownerId))
      .for("update")
      .limit(1);
    if (player[0] && !player[0].homeColonyId) {
      await tx.update(players).set({ homeColonyId: colonyId }).where(eq(players.id, event.ownerId));
    }
  }

  await tx.delete(fleets).where(and(eq(fleets.id, p.fleetId), eq(fleets.ownerId, event.ownerId)));
}

/**
 * Drain up to `limit` overdue events in a single transaction using
 * SELECT ... FOR UPDATE SKIP LOCKED so concurrent drains don't collide.
 */
export async function drainDueEvents(
  db: Db,
  now: number,
  limit: number = 500,
): Promise<{ drained: number; emitted: number; affectedOwnerIds: Set<string> }> {
  return db.transaction(async (tx) => {
    const due = await tx.execute<{
      id: string;
      kind: string;
      payload_version: number;
      owner_id: string;
      fire_at: string; // bigint comes back as string from pg driver
      payload: unknown;
    }>(sql`
      SELECT id, kind, payload_version, owner_id, fire_at, payload
      FROM events
      WHERE fire_at <= ${now}
      ORDER BY fire_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);

    if (due.length === 0) {
      return { drained: 0, emitted: 0, affectedOwnerIds: new Set<string>() };
    }

    const affected = new Set<string>();
    const follows: FollowUpEvent[] = [];

    for (const row of due) {
      const event: EventRow = {
        id: row.id,
        kind: row.kind,
        payloadVersion: row.payload_version,
        ownerId: row.owner_id,
        fireAt: Number(row.fire_at),
        payload: row.payload,
      };
      const { followUps, affectedOwnerIds } = await applyEvent(tx, event);
      for (const id of affectedOwnerIds) affected.add(id);
      follows.push(...followUps);
      await tx.delete(events).where(eq(events.id, event.id));
    }

    if (follows.length > 0) {
      await tx.insert(events).values(
        follows.map((f) => ({
          id: f.id,
          kind: f.kind,
          payloadVersion: f.payloadVersion,
          ownerId: f.ownerId,
          fireAt: f.fireAt,
          payload: f.payload,
        })),
      );
    }

    if (affected.size > 0) {
      await tx.update(players).set({ lastSimAt: now }).where(inArray(players.id, [...affected]));
    }

    return { drained: due.length, emitted: follows.length, affectedOwnerIds: affected };
  });
}
