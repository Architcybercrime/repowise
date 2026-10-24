/**
 * Pure layout + filtering for the Live System Map. Filters the system graph to
 * the visible edge kinds, optionally collapses to repos, then positions the
 * nodes with the shared ELK helper (reused from the C4 view — one layout
 * engine, no bespoke positioning). Returns plain data; the hook turns it into
 * React Flow nodes/edges.
 */

import { computeC4Layout, type C4LayoutPosition } from "../../c4/layout/elk-c4-layout";
import type { SystemEdgeKind, SystemGraph } from "@repowise-dev/types";
import { collapseToRepos } from "./collapse";

/** Uniform service-node footprint on the map. */
export const SYSTEM_MAP_NODE_SIZE = { width: 208, height: 96 } as const;

export interface SystemMapView {
  /** Edge kinds to keep; an edge survives only if its kind is in the set. */
  visibleKinds: ReadonlySet<SystemEdgeKind>;
  /** Collapse services into one node per repo. */
  collapsed: boolean;
}

/**
 * Apply the view's filters to a raw system graph. Pure: returns a new graph;
 * nodes are retained even when filtering leaves them edgeless (honest — an
 * isolated service is real signal, not noise to hide).
 */
export function applyView(graph: SystemGraph, view: SystemMapView): SystemGraph {
  const base = applyCollapse(graph, view.collapsed);
  const edges = base.edges.filter((e) => view.visibleKinds.has(e.kind));
  return { ...base, edges };
}

/**
 * The collapse half of the view, without the edge-kind filter. This is what the
 * layout is computed from: collapsing genuinely changes the system's shape, but
 * hiding an edge kind is a lens on the same shape and must not move nodes.
 */
export function applyCollapse(graph: SystemGraph, collapsed: boolean): SystemGraph {
  return collapsed ? collapseToRepos(graph) : graph;
}

/**
 * Position every node via the shared ELK layered layout.
 *
 * Takes the *unfiltered* edge set on purpose. Node positions describe the system,
 * not the current filter, so hiding an edge kind no longer rearranges the map
 * underneath the reader — and no longer pays ELK's ~23ms floor on every toggle.
 * The filtered edges are still the only ones drawn. ELK runs in a worker
 * when one can start, so a large estate is slow to appear, never a frozen tab.
 */
export function computeSystemMapPositions(graph: SystemGraph): Promise<Map<string, C4LayoutPosition>> {
  return computeC4Layout(
    graph.nodes.map((n) => ({
      id: n.id,
      width: SYSTEM_MAP_NODE_SIZE.width,
      height: SYSTEM_MAP_NODE_SIZE.height,
    })),
    // Structural edges only: placement should read as dependency direction,
    // and co-change pairs are undirected history that would add layers.
    graph.edges
      .filter((e) => e.structural)
      .map((e) => ({ id: e.id, source: e.source, target: e.target })),
    { worker: true },
  );
}

/**
 * Identity of a layout: the node set plus the edges that shape it. Two views with
 * the same signature must get the same positions, which is what lets the hook
 * skip ELK when only the edge-kind filter moved.
 */
export function layoutSignature(graph: SystemGraph): string {
  const nodes = graph.nodes.map((n) => n.id).sort();
  const edges = graph.edges.map((e) => `${e.source}>${e.target}`).sort();
  return `${nodes.join("|")}#${edges.join("|")}`;
}
