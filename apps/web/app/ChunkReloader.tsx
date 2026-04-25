"use client";

import { useEffect } from "react";

/**
 * GitHub Pages auto-recover:
 *
 * Every deploy changes Next.js chunk hashes. If a user had an old
 * HTML cached when we pushed a new build, the old HTML's
 * `<script src="/_next/static/chunks/XXXX.hash.js">` now 404s because
 * the chunk on disk has a different hash. Next throws `ChunkLoadError`.
 *
 * We catch it once and reload — the reload pulls a fresh HTML that
 * references the current chunk hashes. Session storage guards against
 * a reload loop if something's actually broken beyond stale cache.
 */
export function ChunkReloader() {
  useEffect(() => {
    const reload = (why: string) => {
      const key = "sb_chunk_reload_at";
      const last = Number(sessionStorage.getItem(key) ?? "0");
      const now = Date.now();
      if (now - last < 5000) {
        console.warn(`[chunk-reloader] skipping ${why} — reloaded recently`);
        return;
      }
      sessionStorage.setItem(key, String(now));
      console.warn(`[chunk-reloader] ${why} — reloading to get fresh chunks`);
      window.location.reload();
    };

    const looksLikeChunkError = (name: string | undefined, msg: string | undefined) => {
      if (name === "ChunkLoadError") return true;
      if (typeof msg !== "string") return false;
      return msg.includes("Loading chunk") || msg.includes("ChunkLoadError");
    };

    const onError = (e: ErrorEvent) => {
      if (looksLikeChunkError(e.error?.name, e.message)) reload("error-event");
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      const name = r && typeof r === "object" ? (r as { name?: string }).name : undefined;
      const msg = r && typeof r === "object" ? (r as { message?: string }).message : undefined;
      if (looksLikeChunkError(name, msg)) reload("promise-rejection");
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
