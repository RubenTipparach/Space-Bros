import { NextResponse } from "next/server";
import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import {
  COLONY_SHIP_COST,
  colonistsForShip,
  distanceLy,
  travelEstimate,
} from "@space-bros/shared";
import { getCurrentUserId, UnauthorizedError } from "@/lib/auth";
import { schema } from "@/lib/db/client";
import { getGalaxy } from "@/lib/galaxy-server";
import {
  OrderError,
  deductResources,
  loadResources,
  runIdempotentOrder,
  scheduleEvent,
} from "@/lib/db/orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LaunchSchema = z.object({
  orderId: z.string().min(8).max(128),
  fromStarId: z.number().int().nonnegative(),
  toStarId: z.number().int().nonnegative(),
  toPlanetIndex: z.number().int().nonnegative(),
});

const { colonies, research, fleets } = schema;

export async function POST(request: Request) {
  try {
    const userId = await getCurrentUserId();
    const raw = await request.json().catch(() => null);
    const parsed = LaunchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "bad_request", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { orderId, fromStarId, toStarId, toPlanetIndex } = parsed.data;

    if (fromStarId === toStarId) {
      return NextResponse.json(
        { error: "same_system", message: "Pick a target in a different star system." },
        { status: 400 },
      );
    }

    const galaxy = getGalaxy();
    const fromStar = galaxy.stars[fromStarId];
    const toStar = galaxy.stars[toStarId];
    if (!fromStar || !toStar) {
      return NextResponse.json({ error: "star_not_found" }, { status: 404 });
    }
    const toPlanet = toStar.planets[toPlanetIndex];
    if (!toPlanet) {
      return NextResponse.json({ error: "planet_not_found" }, { status: 404 });
    }

    const outcome = await runIdempotentOrder(
      userId,
      orderId,
      "launch_colony",
      parsed.data,
      async (tx) => {
        // Must own a colony at the source star.
        const ownsFrom = await tx
          .select({ id: colonies.id })
          .from(colonies)
          .where(
            and(eq(colonies.ownerId, userId), like(colonies.planetId, `${fromStarId}:%`)),
          )
          .limit(1);
        if (!ownsFrom[0]) {
          throw new OrderError(
            "no_source_colony",
            "You don't have a colony at the source star.",
            409,
          );
        }

        // Target must be unoccupied.
        const targetPlanetId = `${toStarId}:${toPlanetIndex}`;
        const existing = await tx
          .select({ ownerId: colonies.ownerId })
          .from(colonies)
          .where(eq(colonies.planetId, targetPlanetId))
          .limit(1);
        if (existing[0]) {
          if (existing[0].ownerId === userId) {
            throw new OrderError("colony_exists", "You already have a colony there.", 409);
          }
          throw new OrderError(
            "planet_occupied",
            "Another player has already colonized that planet.",
            409,
          );
        }

        const techRows = await tx
          .select({ techId: research.techId })
          .from(research)
          .where(eq(research.playerId, userId));
        const techs = new Set(techRows.map((r) => r.techId));

        const snap = await loadResources(tx, userId);
        await deductResources(tx, userId, snap, COLONY_SHIP_COST);

        const distance = distanceLy(fromStar, toStar);
        const estimate = travelEstimate(distance, techs);
        const departAt = snap.updatedAt;
        const arriveAt = departAt + estimate.durationMs;

        const fleetId = `flt_${orderId}`;
        await tx.insert(fleets).values({
          id: fleetId,
          ownerId: userId,
          ships: { colony_ship: 1 },
          fromStarId,
          toStarId,
          departAt,
          arriveAt,
        });

        const eventId = `evt_${orderId}`;
        await scheduleEvent(tx, {
          id: eventId,
          kind: "colony_founded",
          ownerId: userId,
          fireAt: arriveAt,
          payload: {
            fleetId,
            planetId: targetPlanetId,
            biome: toPlanet.biome,
            colonists: colonistsForShip(techs),
          },
        });

        return {
          fleetId,
          eventId,
          departAt,
          arriveAt,
          distanceLy: distance,
          travelMs: estimate.durationMs,
          speedMultiplier: estimate.multiplier,
        };
      },
    );

    if (outcome.alreadyApplied) {
      return NextResponse.json({ ok: true, alreadyApplied: true }, { status: 200 });
    }
    return NextResponse.json({ ok: true, ...outcome.result }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (err instanceof OrderError) {
    return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
  }
  if (err instanceof Error && err.message.includes("DATABASE_URL is not set")) {
    return NextResponse.json(
      { error: "db_not_configured", message: "DATABASE_URL is not set." },
      { status: 503 },
    );
  }
  console.error("POST /api/orders/launch failed", err);
  return NextResponse.json({ error: "internal" }, { status: 500 });
}
