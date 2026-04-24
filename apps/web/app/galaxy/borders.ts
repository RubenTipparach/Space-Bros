import type { Galaxy } from "@space-bros/shared";

/**
 * Extract sector / cluster / rim border line segments from a galaxy
 * by walking every group's polygon edges and classifying each one
 * by who owns the adjacent cell.
 *
 * An edge "belongs" to group G if it appears in G's polygon. A Voronoi
 * edge between two interior cells is claimed by exactly two groups;
 * an edge on the galactic rim (where Sutherland-Hodgman clipped one
 * neighbour away) is claimed by exactly one.
 *
 *   - Both groups same sector + same cluster → internal, skipped.
 *   - Both groups same sector, different clusters → cluster border.
 *   - Both groups different sectors → sector border.
 *   - Only one group claims the edge → galaxy rim.
 *
 * Returns three Float32Arrays ready to hand to a `LineSegments`
 * BufferGeometry (pairs of xyz vertices on y = 0). Optionally filters
 * cluster borders to those inside a specific sector when
 * `clusterSectorFilter` is supplied.
 */

export interface BorderData {
  /** sector-vs-sector borders */
  sectorEdges: Float32Array;
  /** galactic rim edges */
  rimEdges: Float32Array;
  /** cluster-vs-cluster borders, grouped by sector id */
  clusterEdgesBySector: Map<string, Float32Array>;
}

interface EdgeEntry {
  a: [number, number];
  b: [number, number];
  /** Groups that claim this edge; cap at 2 (Voronoi cell adjacency). */
  groupIds: string[];
}

function edgeKey(a: [number, number], b: [number, number]): string {
  // Round to 1e-3 precision so neighbouring polygons that share an
  // edge always hash to the same key despite tiny FP noise from the
  // polygon-clipping intersection math.
  const round = (v: number) => Math.round(v * 1_000);
  const ka = `${round(a[0])},${round(a[1])}`;
  const kb = `${round(b[0])},${round(b[1])}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

export function extractBorders(galaxy: Galaxy): BorderData {
  const groupMeta = new Map<string, { sectorId: string; clusterId: string }>();
  const sectorByCluster = new Map(
    galaxy.clusters.map((c) => [c.id, c.sectorId]),
  );
  for (const g of galaxy.groups) {
    const sectorId = sectorByCluster.get(g.clusterId);
    if (!sectorId) continue;
    groupMeta.set(g.id, { sectorId, clusterId: g.clusterId });
  }

  // Collect every polygon edge by canonical key.
  const edgeMap = new Map<string, EdgeEntry>();
  for (const g of galaxy.groups) {
    const poly = g.polygon;
    if (!poly || poly.length < 3) continue;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const pa: [number, number] = [a[0]!, a[1]!];
      const pb: [number, number] = [b[0]!, b[1]!];
      const key = edgeKey(pa, pb);
      let entry = edgeMap.get(key);
      if (!entry) {
        entry = { a: pa, b: pb, groupIds: [] };
        edgeMap.set(key, entry);
      }
      if (entry.groupIds.length < 2) entry.groupIds.push(g.id);
    }
  }

  const sectorEdgeList: number[] = [];
  const rimEdgeList: number[] = [];
  const clusterEdgeListsBySector = new Map<string, number[]>();

  for (const entry of edgeMap.values()) {
    const pushEdge = (target: number[]) => {
      target.push(entry.a[0], 0, entry.a[1], entry.b[0], 0, entry.b[1]);
    };

    if (entry.groupIds.length === 1) {
      // Rim edge — other neighbour was clipped away at the disc.
      pushEdge(rimEdgeList);
      continue;
    }
    if (entry.groupIds.length !== 2) continue;
    const m1 = groupMeta.get(entry.groupIds[0]!);
    const m2 = groupMeta.get(entry.groupIds[1]!);
    if (!m1 || !m2) continue;

    if (m1.sectorId !== m2.sectorId) {
      pushEdge(sectorEdgeList);
    } else if (m1.clusterId !== m2.clusterId) {
      // Both groups in the same sector but different clusters —
      // file under the owning sector so Clusters3D can grab just its
      // sector's cluster borders.
      let list = clusterEdgeListsBySector.get(m1.sectorId);
      if (!list) {
        list = [];
        clusterEdgeListsBySector.set(m1.sectorId, list);
      }
      pushEdge(list);
    }
    // else: internal (same cluster), skip entirely.
  }

  const clusterEdgesBySector = new Map<string, Float32Array>();
  for (const [sid, arr] of clusterEdgeListsBySector) {
    clusterEdgesBySector.set(sid, new Float32Array(arr));
  }

  return {
    sectorEdges: new Float32Array(sectorEdgeList),
    rimEdges: new Float32Array(rimEdgeList),
    clusterEdgesBySector,
  };
}
