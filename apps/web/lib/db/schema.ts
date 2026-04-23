import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * All sim timestamps are stored as `bigint` epoch milliseconds so they
 * round-trip cleanly with the shared sim types (`Millis = number`). Admin
 * metadata (created_at, last_active_at) uses Postgres `timestamptz` so
 * `psql` sessions stay human-friendly.
 *
 * See ARCHITECTURE.md §3 for the authoritative data-model reference.
 */

/** Singleton row describing the one persistent universe. */
export const galaxy = pgTable("galaxy", {
  id: integer("id").primaryKey(),
  seed: text("seed").notNull(),
  generatorVersion: integer("generator_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const players = pgTable(
  "players",
  {
    id: text("id").primaryKey(), // Clerk user id (sub claim)
    displayName: text("display_name").notNull(),
    homeColonyId: text("home_colony_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Watermark: the event-queue drain has caught this player up to here.
     * Clients compare this to their last-seen value to decide whether
     * anything changed; the cron bumps it when it processes an event.
     */
    lastSimAt: bigint("last_sim_at", { mode: "number" }).notNull(),
    /**
     * Global credits accumulator. The only empire-wide resource (ADR-012);
     * everything else lives per-colony on the `colonies` row.
     * Rate is the sum of every trade hub's output across all colonies.
     */
    creditsValue: doublePrecision("credits_value").notNull().default(0),
    creditsRate: doublePrecision("credits_rate").notNull().default(0),
    creditsT0: bigint("credits_t0", { mode: "number" }).notNull(),
  },
  (t) => [index("players_last_active_idx").on(t.lastActiveAt)],
);

/**
 * Colonies carry their own per-(metal/food/science/military) accumulators
 * (ADR-012). Twelve columns is wide but it keeps the hot read path
 * (one row per colony) join-free.
 *
 * `buildings` is a `jsonb` map of `{ buildingType: tierLevel }` for now;
 * if SP-1b shows we need to query individual buildings, promote it to a
 * proper child table.
 */
export const colonies = pgTable(
  "colonies",
  {
    id: text("id").primaryKey(), // `${playerId}:${planetId}`
    ownerId: text("owner_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    planetId: text("planet_id").notNull(), // `${starId}:${planetIndex}`
    biome: text("biome").notNull(),
    foundedAt: bigint("founded_at", { mode: "number" }).notNull(),
    populationValue: doublePrecision("population_value").notNull().default(0),
    populationRate: doublePrecision("population_rate").notNull().default(0),
    populationT0: bigint("population_t0", { mode: "number" }).notNull(),
    populationCap: doublePrecision("population_cap"),
    buildings: jsonb("buildings")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    // Per-colony resource stockpiles.
    metalValue: doublePrecision("metal_value").notNull().default(0),
    metalRate: doublePrecision("metal_rate").notNull().default(0),
    metalT0: bigint("metal_t0", { mode: "number" }).notNull(),
    foodValue: doublePrecision("food_value").notNull().default(0),
    foodRate: doublePrecision("food_rate").notNull().default(0),
    foodT0: bigint("food_t0", { mode: "number" }).notNull(),
    scienceValue: doublePrecision("science_value").notNull().default(0),
    scienceRate: doublePrecision("science_rate").notNull().default(0),
    scienceT0: bigint("science_t0", { mode: "number" }).notNull(),
    militaryValue: doublePrecision("military_value").notNull().default(0),
    militaryRate: doublePrecision("military_rate").notNull().default(0),
    militaryT0: bigint("military_t0", { mode: "number" }).notNull(),
  },
  (t) => [
    index("colonies_owner_idx").on(t.ownerId),
    index("colonies_planet_idx").on(t.planetId),
  ],
);

/**
 * Sparse: one row only for planets that have been terraformed or pinned.
 * Everything else resolves purely from `galaxy.seed + generatorVersion`.
 */
export const planetOverlays = pgTable("planet_overlays", {
  planetId: text("planet_id").primaryKey(),
  biome: text("biome"),
  habitability: doublePrecision("habitability"),
  pinnedAt: timestamp("pinned_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const fleets = pgTable(
  "fleets",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    ships: jsonb("ships").$type<Record<string, number>>().notNull(),
    fromStarId: integer("from_star_id").notNull(),
    toStarId: integer("to_star_id").notNull(),
    departAt: bigint("depart_at", { mode: "number" }).notNull(),
    arriveAt: bigint("arrive_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("fleets_owner_idx").on(t.ownerId),
    index("fleets_arrive_idx").on(t.arriveAt),
  ],
);

export const research = pgTable(
  "research",
  {
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    techId: text("tech_id").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.techId] })],
);

/**
 * Event queue. The cron tick drains rows where `fire_at <= now()` using
 * `FOR UPDATE SKIP LOCKED` so concurrent drains are safe.
 *
 * `payload_version` is the compatibility hinge for a persistent universe
 * (see ARCHITECTURE.md §9): reducers switch on (kind, payload_version)
 * and never remove old handlers.
 */
export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    payloadVersion: integer("payload_version").notNull().default(1),
    ownerId: text("owner_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    fireAt: bigint("fire_at", { mode: "number" }).notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("events_fire_at_idx").on(t.fireAt),
    index("events_owner_fire_at_idx").on(t.ownerId, t.fireAt),
  ],
);

/**
 * Append-only audit of player orders, keyed by a client-supplied
 * idempotency key so retries collapse to a single row.
 */
export const ordersLog = pgTable(
  "orders_log",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("orders_log_player_idx").on(t.playerId, t.createdAt)],
);
