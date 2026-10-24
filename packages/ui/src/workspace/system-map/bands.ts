/**
 * Bands: turn system edges into what the map draws, given where each service
 * is drawn. Two service cards keep their own edges (kind and match dash
 * intact); any pair where one end aggregates (a group card, the tray, a
 * "+N more" node) gets one band per ordered pair, carrying the link count and
 * the kind mix. Opposite directions are two bands, so a cycle stays visible.
 * Pure, no React.
 */

import { linkWeight } from "./edge-families";
import type { DrawnBand, DrawnEdge, LevelsEdge, LinkSummary } from "./level-types";

export function emptySummary(): LinkSummary {
  return { links: 0, edges: 0, kinds: {}, gatewayLinks: 0, edgeIds: [] };
}

/** Fold one edge into a summary, in place. */
export function addLink(summary: LinkSummary, edge: LevelsEdge): void {
  const w = linkWeight(edge);
  summary.links += w;
  summary.edges += 1;
  summary.kinds[edge.kind] = (summary.kinds[edge.kind] ?? 0) + w;
  if (edge.strategy === "gateway_route") summary.gatewayLinks += w;
  summary.edgeIds.push(edge.id);
}

export function summarizeLinks(edges: Iterable<LevelsEdge>): LinkSummary {
  const s = emptySummary();
  for (const e of edges) addLink(s, e);
  return s;
}

export function bandId(source: string, target: string): string {
  return `band:${source}>${target}`;
}

export interface ConnectedEdges {
  /** Drawn connectors, sorted by id. */
  edges: DrawnEdge[];
  /** Links whose two ends land on the same aggregate node, keyed by that node. */
  inside: Map<string, LinkSummary>;
}

/**
 * Connect `edges` between drawn nodes. `drawnAt(serviceId)` names the node a
 * service is drawn as (or inside), null when it is not on the canvas;
 * `isServiceCard(drawnId)` is true when that node is the service's own card.
 */
export function connectEdges(
  edges: Iterable<LevelsEdge>,
  drawnAt: (serviceId: string) => string | null,
  isServiceCard: (drawnId: string) => boolean,
): ConnectedEdges {
  const singles: DrawnEdge[] = [];
  const bands = new Map<string, DrawnBand>();
  const inside = new Map<string, LinkSummary>();
  for (const e of edges) {
    const source = drawnAt(e.source);
    const target = drawnAt(e.target);
    if (source === null || target === null) continue;
    if (source === target) {
      // A self-edge on a card has nothing to draw; inside an aggregate it is an "inside" link.
      if (isServiceCard(source)) continue;
      let s = inside.get(source);
      if (!s) inside.set(source, (s = emptySummary()));
      addLink(s, e);
      continue;
    }
    if (isServiceCard(source) && isServiceCard(target)) {
      singles.push({ type: "edge", id: e.id, source, target, edgeId: e.id });
      continue;
    }
    const id = bandId(source, target);
    let band = bands.get(id);
    if (!band) bands.set(id, (band = { type: "band", id, source, target, summary: emptySummary() }));
    addLink(band.summary, e);
  }
  const out = [...singles, ...bands.values()];
  out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return { edges: out, inside };
}
