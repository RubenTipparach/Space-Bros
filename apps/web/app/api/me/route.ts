import { NextResponse } from "next/server";
import { getCurrentUserId, UnauthorizedError, isDevUser } from "@/lib/auth";
import {
  getCompletedResearch,
  getOrCreatePlayer,
  getPendingResearch,
  getPlayerColonies,
  getPlayerCredits,
  getPlayerFleets,
  getPlayerHomeColony,
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    const player = await getOrCreatePlayer(userId);

    const [homeColony, credits, research, pendingResearch, colonies, fleets] = await Promise.all([
      player.homeColonyId ? getPlayerHomeColony(userId) : Promise.resolve(null),
      getPlayerCredits(userId),
      getCompletedResearch(userId),
      getPendingResearch(userId),
      getPlayerColonies(userId),
      getPlayerFleets(userId),
    ]);

    return NextResponse.json({
      player: {
        id: player.id,
        displayName: player.displayName,
        homeColonyId: player.homeColonyId,
        lastSimAt: player.lastSimAt,
        isDevUser: isDevUser(player.id),
      },
      homeColony,
      credits,
      research,
      pendingResearch,
      colonies,
      fleets,
      serverTime: Date.now(),
    });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
  console.error("GET /api/me failed", err);
  return NextResponse.json({ error: "internal" }, { status: 500 });
}
