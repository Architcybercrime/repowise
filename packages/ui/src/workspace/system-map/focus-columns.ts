/**
 * Focus (L2): one service in the middle, what calls it on the left, what it
 * depends on on the right, sorted by link count so each column reads as a
 * list. A service on both sides sits in both columns, marked `bothWays`.
 * Two hops add callers of callers far left and dependencies of dependencies
 * far right. Placement is a fixed column grid, no ELK. Pure, no React.
 */

import type { C4LayoutPosition } from "../../c4/layout/elk-c4-layout";
import { addLink, bandId, compareIds, emptySummary } from "./bands";
import { allocateSlots } from "./draw-budget";
import { edgeFamily, type EdgeFamily } from "./edge-families";
import type { DrawBudget, FocusColumnId, LevelsEdge, LevelsGraph, LinkSummary } from "./level-types";

export interface FocusEntry {
  serviceId: string;
  /** Links between this service and its neighbour column (the focus, for one hop). */
  summary: LinkSummary;
  bothWays: boolean;
}

export interface FocusColumn {
  id: FocusColumnId;
  /** Drawn entries, strongest first. */
  entries: FocusEntry[];
  /** Service ids the draw budget folded into the column's "+N more" node. */
  folded: string[];
}

/** A connector between two drawn ids, every link of the pair in one. */
export interface FocusConnector {
  id: string;
  source: string;
  target: string;
  summary: LinkSummary;
}

export interface FocusLayout {
  focus: string;
  hops: 1 | 2;
  /** Left to right, without the focus: callers2?, callers, dependencies, dependencies2?. */
  columns: FocusColumn[];
  connectors: FocusConnector[];
}

/** Drawn id of a service card in a focus column; the focus card keeps the service id. */
export function focusNodeId(column: FocusColumnId, serviceId: string): string {
  return `${column}:${serviceId}`;
}

export function focusMoreId(column: FocusColumnId): string {
  return `more:${column}`;
}

type Neighbours = Map<string, LinkSummary>;

function collect(into: Neighbours, key: string, edge: LevelsEdge): void {
  let s = into.get(key);
  if (!s) into.set(key, (s = emptySummary()));
  addLink(s, edge);
}

function ranked(neighbours: Neighbours, other: Neighbours): FocusEntry[] {
  return [...neighbours]
    .map(([serviceId, summary]) => ({ serviceId, summary, bothWays: other.has(serviceId) }))
    .sort((x, y) => y.summary.links - x.summary.links || compareIds(x.serviceId, y.serviceId));
}

/**
 * Columns around `focus` in the families shown, folded to the draw budget.
 * Null when `focus` is not a service in the graph.
 */
export function focusColumns(
  graph: LevelsGraph,
  focus: string,
  options: { families: ReadonlySet<EdgeFamily>; hops?: 1 | 2 | undefined; budget: DrawBudget },
): FocusLayout | null {
  if (!graph.nodes.some((n) => n.id === focus)) return null;
  const hops = options.hops ?? 1;
  const edges = graph.edges.filter(
    (e) => e.source !== e.target && options.families.has(edgeFamily(e.kind)),
  );

  const callers: Neighbours = new Map();
  const deps: Neighbours = new Map();
  for (const e of edges) {
    if (e.target === focus) collect(callers, e.source, e);
    if (e.source === focus) collect(deps, e.target, e);
  }
  const plan: { id: FocusColumnId; entries: FocusEntry[] }[] = [
    { id: "callers", entries: ranked(callers, deps) },
    { id: "dependencies", entries: ranked(deps, callers) },
  ];
  if (hops === 2) {
    const ring1 = new Set([focus, ...callers.keys(), ...deps.keys()]);
    const callers2: Neighbours = new Map();
    const deps2: Neighbours = new Map();
    for (const e of edges) {
      if (callers.has(e.target) && !ring1.has(e.source)) collect(callers2, e.source, e);
      if (deps.has(e.source) && !ring1.has(e.target)) collect(deps2, e.target, e);
    }
    plan.unshift({ id: "callers2", entries: ranked(callers2, deps2) });
    plan.push({ id: "dependencies2", entries: ranked(deps2, callers2) });
  }

  const kept = allocateSlots(
    plan.map((c) => ({ size: c.entries.length })),
    options.budget.nodes - 1,
  );
  const columns: FocusColumn[] = plan.map((c, i) => ({
    id: c.id,
    entries: c.entries.slice(0, kept[i]),
    folded: c.entries.slice(kept[i]).map((e) => e.serviceId),
  }));

  // Where each service is drawn in each column: its card, or the column's "+N more".
  const at = new Map<FocusColumnId, Map<string, string>>();
  for (const c of columns) {
    const m = new Map<string, string>();
    for (const e of c.entries) m.set(e.serviceId, focusNodeId(c.id, e.serviceId));
    for (const id of c.folded) m.set(id, focusMoreId(c.id));
    at.set(c.id, m);
  }
  const drawn = (column: FocusColumnId, id: string) => at.get(column)?.get(id) ?? null;

  const connectors = new Map<string, FocusConnector>();
  const connect = (source: string | null, target: string | null, e: LevelsEdge) => {
    if (source === null || target === null) return;
    const id = bandId(source, target);
    let c = connectors.get(id);
    if (!c) connectors.set(id, (c = { id, source, target, summary: emptySummary() }));
    addLink(c.summary, e);
  };
  for (const e of edges) {
    if (e.target === focus) connect(drawn("callers", e.source), focus, e);
    if (e.source === focus) connect(focus, drawn("dependencies", e.target), e);
    if (hops === 2) {
      connect(drawn("callers2", e.source), drawn("callers", e.target), e);
      connect(drawn("dependencies", e.source), drawn("dependencies2", e.target), e);
    }
  }
  return {
    focus,
    hops,
    columns,
    connectors: [...connectors.values()].sort((x, y) => compareIds(x.id, y.id)),
  };
}

export interface FocusPlacement {
  /** Card footprint, the same for every column. */
  size: { width: number; height: number };
  /** Horizontal gap between columns and vertical gap between cards. */
  gap?: { x: number; y: number };
}

/**
 * Top-left positions for every drawn id: columns left to right, each centred
 * on the focus card's row. Deterministic: same layout in, same positions out.
 */
export function placeFocusColumns(layout: FocusLayout, placement: FocusPlacement): Map<string, C4LayoutPosition> {
  const { width, height } = placement.size;
  const gap = placement.gap ?? { x: 96, y: 16 };
  const left = layout.columns.filter((c) => c.id === "callers2" || c.id === "callers");
  const right = layout.columns.filter((c) => c.id === "dependencies" || c.id === "dependencies2");
  const stacks: string[][] = [
    ...left.map((c) => columnIds(c)),
    [layout.focus],
    ...right.map((c) => columnIds(c)),
  ];
  const positions = new Map<string, C4LayoutPosition>();
  stacks.forEach((ids, col) => {
    const top = -((ids.length * height + (ids.length - 1) * gap.y) / 2);
    ids.forEach((id, row) => {
      positions.set(id, { x: col * (width + gap.x), y: top + row * (height + gap.y), width, height });
    });
  });
  return positions;
}

function columnIds(column: FocusColumn): string[] {
  const ids = column.entries.map((e) => focusNodeId(column.id, e.serviceId));
  if (column.folded.length > 0) ids.push(focusMoreId(column.id));
  return ids;
}
