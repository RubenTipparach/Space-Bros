import { generateGalaxy } from "@space-bros/shared";

export default function Home() {
  const galaxy = generateGalaxy({ seed: "space-bros-dev", starCount: 2_000 });
  const planetCount = galaxy.stars.reduce((n, s) => n + s.planets.length, 0);
  const habitable = galaxy.stars.reduce(
    (n, s) => n + s.planets.filter((p) => p.habitability > 0.5).length,
    0,
  );

  return (
    <main>
      <h1>Space Bros</h1>
      <p>Build spaceships. Conquer the galaxy. Slowly.</p>
      <section>
        <h2>Chunk 0: skeleton alive</h2>
        <p>
          Generated a test galaxy from seed <code>{String(galaxy.seed)}</code>{" "}
          (gen v{galaxy.generatorVersion}).
        </p>
        <ul>
          <li>{galaxy.stars.length.toLocaleString()} stars</li>
          <li>{planetCount.toLocaleString()} planets</li>
          <li>{habitable.toLocaleString()} habitable (&gt; 0.5)</li>
        </ul>
        <p>
          Next chunks: Three.js viewer (Chunk 2), sim event queue wired to
          Postgres (Chunks 3–5).
        </p>
      </section>
    </main>
  );
}
