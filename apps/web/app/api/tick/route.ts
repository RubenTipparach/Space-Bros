import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { drainDueEvents } from "@/lib/db/tick";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vercel Hobby caps cron invocations at 60s. Pro: up to 300s. We size
// the drain batch so a single run comfortably fits inside either.
export const maxDuration = 60;

const DRAIN_LIMIT = 500;

/**
 * Cron-driven event-queue drain.
 *
 * Vercel Cron sends requests with an `Authorization: Bearer <CRON_SECRET>`
 * header; manual/admin triggers must send the same header. Without a
 * configured `CRON_SECRET` we reject everything except local dev, so an
 * accidentally-public deployment doesn't expose an unauthenticated
 * event-processing endpoint.
 */
async function handle(request: Request): Promise<Response> {
  const unauthorized = authCheck(request);
  if (unauthorized) return unauthorized;

  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
  } catch (err) {
    if (err instanceof Error && err.message.includes("DATABASE_URL is not set")) {
      return NextResponse.json(
        { error: "db_not_configured", message: "DATABASE_URL is not set." },
        { status: 503 },
      );
    }
    throw err;
  }

  const startedAt = Date.now();
  try {
    const result = await drainDueEvents(db, startedAt, DRAIN_LIMIT);
    const tookMs = Date.now() - startedAt;
    return NextResponse.json({
      ok: true,
      drained: result.drained,
      emitted: result.emitted,
      affected: result.affectedOwnerIds.size,
      tookMs,
    });
  } catch (err) {
    console.error("tick drain failed", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

function authCheck(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;

  // Local dev: if CRON_SECRET is unset and we're not in a Vercel
  // production deploy, allow the caller so you can exercise the drain
  // with `curl localhost:3000/api/tick`.
  if (!secret) {
    if (process.env.VERCEL_ENV === "production") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return null;
  }

  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

// Vercel Cron defaults to GET; accept both so admin curls work either way.
export const GET = handle;
export const POST = handle;
