/**
 * The System Map levels model: view state in, drawn graph out.
 *
 *  - Estate (L0) and group open (L1): `estate-view.ts`.
 *  - Focus (L2): callers, the service, dependencies (`focus-columns.ts`).
 *  - Between (L3): two services, the services on the paths joining them, and
 *    every drawn link among them (`between.ts`).
 *
 * Precedence is between, then focus, then the estate; an id that names no
 * service falls through to the next level. Every level is held to the draw
 * budget, and what does not fit is counted in the truncation report.
 * Pure, no React, deterministic.
 */

import { compareIds, connectEdges } from "./bands";
import { servicesBetween, type BetweenResult } from "./between";
import { DRAW_BUDGET, capEdges, truncationReport } from "./draw-budget";
import {
  DEFAULT_EDGE_FAMILIES,
  edgeFamily,
  familyCounts,
  type EdgeFamily,
  type FamilyCount,
} from "./edge-families";
import { buildEstateView } from "./estate-view";
import { focusColumns, focusMoreId, focusNodeId, type FocusLayout } from "./focus-columns";
import type {
  DrawBudget,
  DrawnEdge,
  DrawnNode,
  LevelViewState,
  LevelsGraph,
  MapLevel,
  TruncationReport,
} from "./level-types";

export interface LevelView {
  level: MapLevel;
  /** True when the estate is drawn as groups. */
  grouped: boolean;
  nodes: DrawnNode[];
  edges: DrawnEdge[];
  /** Families drawn. */
  families: ReadonlySet<EdgeFamily>;
  /** Edges and links per family present in the whole graph, for the chips and the hidden-family caption. */
  familyCounts: Partial<Record<EdgeFamily, FamilyCount>>;
  truncation: TruncationReport | null;
  /** Focus level only. */
  focus: FocusLayout | null;
  /** Between level only. */
  between: BetweenResult | null;
}

/**
 * One node per id, edges only between known nodes, both in id order, so a
 * payload with duplicates or dangling edges draws no phantom card and every
 * summary lists its edge ids the same way whatever order the payload arrived
 * in. The first of duplicate ids wins.
 */
export function normalizeGraph(graph: LevelsGraph): LevelsGraph {
  const nodes = new Map<string, LevelsGraph["nodes"][number]>();
  for (const n of graph.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
  const edges = new Map<string, LevelsGraph["edges"][number]>();
  for (const e of graph.edges) {
    if (nodes.has(e.source) && nodes.has(e.target) && !edges.has(e.id)) edges.set(e.id, e);
  }
  return {
    ...graph,
    nodes: [...nodes.values()].sort((x, y) => compareIds(x.id, y.id)),
    edges: [...edges.values()].sort((x, y) => compareIds(x.id, y.id)),
  };
}

/** The drawn graph for a view state. Exported helpers below it expect a normalized graph. */
export function buildLevelView(
  graph: LevelsGraph,
  state: LevelViewState = {},
  budget: DrawBudget = DRAW_BUDGET,
): LevelView {
  graph = normalizeGraph(graph);
  const families = state.families ?? DEFAULT_EDGE_FAMILIES;
  const base = { families, familyCounts: familyCounts(graph.edges), focus: null, between: null };
  const visible = graph.edges.filter((e) => families.has(edgeFamily(e.kind)));
  const edgesById = new Map(graph.edges.map((e) => [e.id, e]));

  if (state.between) {
    const between = servicesBetween(graph, state.between.a, state.between.b, { families });
    if (between) {
      const drawn = new Set([between.a, between.b]);
      for (const p of [...between.pathsAToB, ...between.pathsBToA]) p.nodes.forEach((id) => drawn.add(id));
      const order = [...drawn].sort();
      const edges = connectEdges(visible, (id) => (drawn.has(id) ? id : null), () => true);
      const capped = capEdges(edges, budget.edges, edgesById);
      return {
        ...base,
        level: "between",
        grouped: false,
        between,
        nodes: order.map((id) => ({ type: "service", id, serviceId: id, parentId: null })),
        edges: capped.edges,
        truncation: truncationReport(budget, 0, 0, capped.droppedEdges, capped.droppedLinks),
      };
    }
  }

  if (state.focus) {
    const focus = focusColumns(graph, state.focus, { families, hops: state.hops, budget });
    if (focus) {
      const nodes: DrawnNode[] = [];
      const folded = new Set<string>();
      const pushColumn = (index: number) => {
        const c = focus.columns[index];
        if (!c) return;
        for (const e of c.entries) {
          nodes.push({
            type: "service",
            id: focusNodeId(c.id, e.serviceId),
            serviceId: e.serviceId,
            parentId: null,
            column: c.id,
            links: e.summary,
            bothWays: e.bothWays,
          });
        }
        if (c.folded.length > 0) {
          c.folded.forEach((id) => folded.add(id));
          nodes.push({ type: "more", id: focusMoreId(c.id), parentId: null, serviceIds: c.folded, groupIds: [] });
        }
      };
      const leftCount = focus.hops === 2 ? 2 : 1;
      for (let i = 0; i < leftCount; i++) pushColumn(i);
      nodes.push({ type: "service", id: focus.focus, serviceId: focus.focus, parentId: null, column: "focus" });
      for (let i = leftCount; i < focus.columns.length; i++) pushColumn(i);
      const edges: DrawnEdge[] = focus.connectors.map((c) => ({ type: "band", ...c }));
      const capped = capEdges(edges, budget.edges, edgesById);
      return {
        ...base,
        level: "focus",
        grouped: false,
        focus,
        nodes,
        edges: capped.edges,
        truncation: truncationReport(budget, folded.size, 0, capped.droppedEdges, capped.droppedLinks),
      };
    }
  }

  return { ...base, ...buildEstateView(graph, state, visible, edgesById, budget) };
}

