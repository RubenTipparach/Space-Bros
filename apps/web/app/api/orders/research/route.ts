import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getTech } from "@space-bros/shared";
import { getCurrentUserId, UnauthorizedError } from "@/lib/auth";
import { schema } from "@/lib/db/client";
import {
  OrderError,
  deductResources,
  findPendingEventOfKind,
  loadResources,
  runIdempotentOrder,
  scheduleEvent,
} from "@/lib/db/orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const StartResearchSchema = z.object({
  orderId: z.string().min(8).max(128),
  techId: z.string().min(1).max(64),
});

const { research } = schema;

export async function POST(request: Request) {
  try {
    const userId = await getCurrentUserId();
    const raw = await request.json().catch(() => null);
    const parsed = StartResearchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
    }
    const { orderId, techId } = parsed.data;

    const tech = getTech(techId);
    if (!tech) {
      return NextResponse.json({ error: "unknown_tech", techId }, { status: 404 });
    }

    const outcome = await runIdempotentOrder(userId, orderId, "start_research", parsed.data, async (tx) => {
      // Already researched?
      const owned = await tx
        .select({ techId: research.techId })
        .from(research)
        .where(and(eq(research.playerId, userId), eq(research.techId, techId)))
        .limit(1);
      if (owned[0]) {
        throw new OrderError("already_researched", "You have already researched that tech.", 409);
      }

      // Prereqs met?
      if (tech.prereqs.length > 0) {
        const ownedPrereqRows = await tx
          .select({ techId: research.techId })
          .from(research)
          .where(eq(research.playerId, userId));
        const ownedSet = new Set(ownedPrereqRows.map((r) => r.techId));
        const missing = tech.prereqs.filter((p) => !ownedSet.has(p));
        if (missing.length > 0) {
          throw new OrderError("missing_prereqs", `Missing prereqs: ${missing.join(", ")}`, 409);
        }
      }

      // One research at a time.
      const inProgress = await findPendingEventOfKind(tx, userId, "research_complete");
      if (inProgress) {
        throw new OrderError("already_researching", "You are already researching something.", 409);
      }

      const snapshot = await loadResources(tx, userId);
      await deductResources(tx, userId, snapshot, tech.cost);

      const now = snapshot.updatedAt;
      const fireAt = now + tech.durationSeconds * 1000;
      const eventId = `evt_${orderId}`;
      await scheduleEvent(tx, {
        id: eventId,
        kind: "research_complete",
        ownerId: userId,
        fireAt,
        payload: { techId },
      });

      return {
        eventId,
        fireAt,
        techId,
        durationSeconds: tech.durationSeconds,
      };
    });

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
  console.error("POST /api/orders/research failed", err);
  return NextResponse.json({ error: "internal" }, { status: 500 });
}
