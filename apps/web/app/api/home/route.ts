import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId, UnauthorizedError } from "@/lib/auth";
import { foundHomeColony, getOrCreatePlayer, QueryError } from "@/lib/db/queries";
import { getPlanet } from "@/lib/galaxy-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PickHomeSchema = z.object({
  starId: z.number().int().nonnegative(),
  planetIndex: z.number().int().nonnegative(),
});

const INITIAL_POPULATION = 1_000;
const BASE_POPULATION_RATE_PER_SEC = 0.05;

export async function POST(request: Request) {
  try {
    const userId = await getCurrentUserId();
    const raw = await request.json().catch(() => null);
    const parsed = PickHomeSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "bad_request", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { starId, planetIndex } = parsed.data;
    const target = getPlanet(starId, planetIndex);
    if (!target) {
      return NextResponse.json({ error: "planet_not_found" }, { status: 404 });
    }
    if (target.planet.habitability < 0.2) {
      return NextResponse.json(
        {
          error: "planet_uninhabitable",
          message: "Home planets need habitability >= 0.2. Pick somewhere else.",
        },
        { status: 400 },
      );
    }

    await getOrCreatePlayer(userId);

    const planetId = `${starId}:${planetIndex}`;
    const rate = BASE_POPULATION_RATE_PER_SEC * Math.max(0.2, target.planet.habitability);

    const colony = await foundHomeColony({
      userId,
      planetId,
      biome: target.planet.biome,
      initialPopulation: INITIAL_POPULATION,
      populationRatePerSec: rate,
    });

    return NextResponse.json({ colony }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (err instanceof QueryError) {
    const status = err.code === "home_already_set" || err.code === "colony_exists" ? 409 : 400;
    return NextResponse.json({ error: err.code, message: err.message }, { status });
  }
  if (err instanceof Error && err.message.includes("DATABASE_URL is not set")) {
    return NextResponse.json(
      {
        error: "db_not_configured",
        message: "DATABASE_URL is not set. See apps/web/.env.example.",
      },
      { status: 503 },
    );
  }
  console.error("POST /api/home failed", err);
  return NextResponse.json({ error: "internal" }, { status: 500 });
}
