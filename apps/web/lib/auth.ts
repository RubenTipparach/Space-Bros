import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

/**
 * Auth abstraction for the API routes.
 *
 * Two modes:
 *
 * - **Production (Clerk):** when `CLERK_SECRET_KEY` is set we defer to
 *   `@clerk/nextjs/server` — drop that import in when wiring Clerk.
 *   Until then, this file has no `@clerk` dependency so `pnpm install`
 *   stays lean.
 *
 * - **Dev-cookie fallback:** we mint a stable anonymous id per browser
 *   in a cookie (`sb_dev_user`). This is NOT secure — it only lets us
 *   exercise the full server flow locally without paid accounts. It
 *   is rejected in production (see `DevCookieDisabledError`).
 */

const COOKIE_NAME = "sb_dev_user";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

export class UnauthorizedError extends Error {
  constructor(message = "Not signed in") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class DevCookieDisabledError extends Error {
  constructor() {
    super("Dev-cookie auth is not allowed in production. Configure Clerk.");
    this.name = "DevCookieDisabledError";
  }
}

function isProd(): boolean {
  return process.env.NODE_ENV === "production" && process.env.VERCEL_ENV === "production";
}

function clerkConfigured(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY);
}

/**
 * Returns the current user's stable id, creating a dev cookie if needed.
 * Throws `UnauthorizedError` in Clerk mode when the caller is signed out.
 */
export async function getCurrentUserId(): Promise<string> {
  if (clerkConfigured()) {
    // TODO(chunk 4c): import { auth } from "@clerk/nextjs/server" and
    // return the `userId` claim here. Throw UnauthorizedError if null.
    throw new Error("Clerk integration not wired yet (chunk 4c).");
  }

  if (isProd()) {
    throw new DevCookieDisabledError();
  }

  const jar = await cookies();
  const existing = jar.get(COOKIE_NAME)?.value;
  if (existing) return existing;

  const fresh = `dev_${randomUUID()}`;
  jar.set(COOKIE_NAME, fresh, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return fresh;
}

/** Useful for debugging + HUD strings. */
export function isDevUser(userId: string): boolean {
  return userId.startsWith("dev_");
}
