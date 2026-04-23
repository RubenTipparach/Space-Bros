import { and, eq } from "drizzle-orm";
import type { Biome } from "@space-bros/shared";
import { getDb, schema } from "./client";

const { players, playerResources, colonies } = schema;

export interface PlayerRow {
  id: string;
  displayName: string;
  homeColonyId: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  lastSimAt: number;
}

export interface ColonyRow {
  id: string;
  ownerId: string;
  planetId: string;
  biome: string;
  foundedAt: number;
  populationValue: number;
  populationRate: number;
  populationT0: number;
  populationCap: number | null;
  buildings: Record<string, number>;
}

/**
 * Returns the player row, creating it (and its resources row) on first
 * sight. Bumps `last_active_at`. One round-trip on the hot path.
 */
export async function getOrCreatePlayer(userId: string): Promise<PlayerRow> {
  const db = getDb();
  const now = Date.now();

  const existing = await db.select().from(players).where(eq(players.id, userId)).limit(1);
  if (existing[0]) {
    const row = existing[0];
    await db.update(players).set({ lastActiveAt: new Date(now) }).where(eq(players.id, userId));
    return toPlayerRow(row);
  }

  const displayName = `Commander ${userId.slice(-4).toUpperCase()}`;
  const [inserted] = await db
    .insert(players)
    .values({
      id: userId,
      displayName,
      homeColonyId: null,
      lastActiveAt: new Date(now),
      lastSimAt: now,
    })
    .returning();

  await db.insert(playerResources).values({
    playerId: userId,
    metalT0: now,
    energyT0: now,
    scienceT0: now,
  });

  return toPlayerRow(inserted!);
}

export async function getPlayerHomeColony(userId: string): Promise<ColonyRow | null> {
  const db = getDb();
  const rows = await db.select().from(colonies).where(eq(colonies.ownerId, userId)).limit(1);
  return rows[0] ? toColonyRow(rows[0]) : null;
}

/**
 * Found a player's home colony atomically:
 *   - must not already have a home
 *   - must not conflict on `colonies.id` (player:planetId)
 *   - writes the colony, stamps `players.home_colony_id`
 *
 * Returns the new colony. Throws with a stable `code` on conflict so the
 * route handler can map to 409.
 */
export async function foundHomeColony(args: {
  userId: string;
  planetId: string;
  biome: Biome;
  initialPopulation: number;
  populationRatePerSec: number;
}): Promise<ColonyRow> {
  const db = getDb();
  const now = Date.now();
  const colonyId = `${args.userId}:${args.planetId}`;

  return db.transaction(async (tx) => {
    const player = await tx
      .select()
      .from(players)
      .where(eq(players.id, args.userId))
      .for("update")
      .limit(1);

    if (!player[0]) {
      throw new QueryError("player_not_found", "Player does not exist.");
    }
    if (player[0].homeColonyId) {
      throw new QueryError("home_already_set", "This player already has a home colony.");
    }

    const conflict = await tx
      .select({ id: colonies.id })
      .from(colonies)
      .where(and(eq(colonies.ownerId, args.userId), eq(colonies.planetId, args.planetId)))
      .limit(1);
    if (conflict[0]) {
      throw new QueryError("colony_exists", "This player already has a colony on that planet.");
    }

    const [colony] = await tx
      .insert(colonies)
      .values({
        id: colonyId,
        ownerId: args.userId,
        planetId: args.planetId,
        biome: args.biome,
        foundedAt: now,
        populationValue: args.initialPopulation,
        populationRate: args.populationRatePerSec,
        populationT0: now,
      })
      .returning();

    await tx.update(players).set({ homeColonyId: colonyId }).where(eq(players.id, args.userId));

    return toColonyRow(colony!);
  });
}

export class QueryError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "QueryError";
  }
}

function toPlayerRow(row: typeof players.$inferSelect): PlayerRow {
  return {
    id: row.id,
    displayName: row.displayName,
    homeColonyId: row.homeColonyId,
    createdAt: row.createdAt,
    lastActiveAt: row.lastActiveAt,
    lastSimAt: row.lastSimAt,
  };
}

function toColonyRow(row: typeof colonies.$inferSelect): ColonyRow {
  return {
    id: row.id,
    ownerId: row.ownerId,
    planetId: row.planetId,
    biome: row.biome,
    foundedAt: row.foundedAt,
    populationValue: row.populationValue,
    populationRate: row.populationRate,
    populationT0: row.populationT0,
    populationCap: row.populationCap,
    buildings: row.buildings,
  };
}
