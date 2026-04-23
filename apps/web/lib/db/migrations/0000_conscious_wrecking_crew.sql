CREATE TABLE "colonies" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"planet_id" text NOT NULL,
	"biome" text NOT NULL,
	"founded_at" bigint NOT NULL,
	"population_value" double precision DEFAULT 0 NOT NULL,
	"population_rate" double precision DEFAULT 0 NOT NULL,
	"population_t0" bigint NOT NULL,
	"population_cap" double precision,
	"buildings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metal_value" double precision DEFAULT 0 NOT NULL,
	"metal_rate" double precision DEFAULT 0 NOT NULL,
	"metal_t0" bigint NOT NULL,
	"food_value" double precision DEFAULT 0 NOT NULL,
	"food_rate" double precision DEFAULT 0 NOT NULL,
	"food_t0" bigint NOT NULL,
	"science_value" double precision DEFAULT 0 NOT NULL,
	"science_rate" double precision DEFAULT 0 NOT NULL,
	"science_t0" bigint NOT NULL,
	"military_value" double precision DEFAULT 0 NOT NULL,
	"military_rate" double precision DEFAULT 0 NOT NULL,
	"military_t0" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload_version" integer DEFAULT 1 NOT NULL,
	"owner_id" text NOT NULL,
	"fire_at" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleets" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"ships" jsonb NOT NULL,
	"from_star_id" integer NOT NULL,
	"to_star_id" integer NOT NULL,
	"depart_at" bigint NOT NULL,
	"arrive_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "galaxy" (
	"id" integer PRIMARY KEY NOT NULL,
	"seed" text NOT NULL,
	"generator_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders_log" (
	"id" text PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planet_overlays" (
	"planet_id" text PRIMARY KEY NOT NULL,
	"biome" text,
	"habitability" double precision,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"home_colony_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sim_at" bigint NOT NULL,
	"credits_value" double precision DEFAULT 0 NOT NULL,
	"credits_rate" double precision DEFAULT 0 NOT NULL,
	"credits_t0" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research" (
	"player_id" text NOT NULL,
	"tech_id" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_player_id_tech_id_pk" PRIMARY KEY("player_id","tech_id")
);
--> statement-breakpoint
ALTER TABLE "colonies" ADD CONSTRAINT "colonies_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders_log" ADD CONSTRAINT "orders_log_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research" ADD CONSTRAINT "research_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "colonies_owner_idx" ON "colonies" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "colonies_planet_idx" ON "colonies" USING btree ("planet_id");--> statement-breakpoint
CREATE INDEX "events_fire_at_idx" ON "events" USING btree ("fire_at");--> statement-breakpoint
CREATE INDEX "events_owner_fire_at_idx" ON "events" USING btree ("owner_id","fire_at");--> statement-breakpoint
CREATE INDEX "fleets_owner_idx" ON "fleets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "fleets_arrive_idx" ON "fleets" USING btree ("arrive_at");--> statement-breakpoint
CREATE INDEX "orders_log_player_idx" ON "orders_log" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX "players_last_active_idx" ON "players" USING btree ("last_active_at");