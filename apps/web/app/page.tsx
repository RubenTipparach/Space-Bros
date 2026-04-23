"use client";

import dynamic from "next/dynamic";

const GalaxyScene = dynamic(() => import("./galaxy/GalaxyScene"), {
  ssr: false,
  loading: () => <div className="loading">Loading galaxy…</div>,
});

export default function Home() {
  return <GalaxyScene seed="space-bros-dev" starCount={12_000} />;
}
