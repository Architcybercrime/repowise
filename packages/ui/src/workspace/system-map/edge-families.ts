/**
 * Edge families: the four groups the map filters by (Runtime, Data, Build,
 * History). Which kind belongs to which family lives on the kind registry
 * (`SYSTEM_EDGE_KINDS[kind].family`), so a new transport declares its family
 * in the one row it already adds. Pure, no React.
 */

import { edgeKindStyle, type EdgeFamily } from "./edge-kinds";

export type { EdgeFamily };

/** Display order of the family chips. */
export const EDGE_FAMILY_ORDER: readonly EdgeFamily[] = ["runtime", "data", "build", "history"];

/** Drawn on first load: calls, events and shared data. Build and History are opt-in. */
export const DEFAULT_EDGE_FAMILIES: ReadonlySet<EdgeFamily> = new Set<EdgeFamily>(["runtime", "data"]);

/**
 * The families that count as "linked" when the map ranks services and fills
 * the "Not linked at runtime" tray. Fixed on purpose, independent of the
 * filter, so toggling a family never moves a service in or out of the tray
 * and never reorders what the draw budget keeps.
 */
export const LINKED_FAMILIES: ReadonlySet<EdgeFamily> = DEFAULT_EDGE_FAMILIES;

/** The family of an edge kind; an unknown future kind is drawn as Runtime rather than hidden. */
export function edgeFamily(kind: string): EdgeFamily {
  return edgeKindStyle(kind).family;
}

export interface FamilyCount {
  /** System edges of the family. */
  edges: number;
  /** Underlying links (sum of edge weights). */
  links: number;
}

/** Edge and link counts per family, for the chips and the "hidden" caption. Only families present appear. */
export function familyCounts(
  edges: Iterable<{ kind: string; weight: number }>,
): Partial<Record<EdgeFamily, FamilyCount>> {
  const out: Partial<Record<EdgeFamily, FamilyCount>> = {};
  for (const e of edges) {
    const family = edgeFamily(e.kind);
    const row = (out[family] ??= { edges: 0, links: 0 });
    row.edges += 1;
    row.links += linkWeight(e);
  }
  return out;
}

/** Links an edge stands for. An edge exists, so it is never fewer than one. */
export function linkWeight(edge: { weight: number }): number {
  return edge.weight > 1 ? edge.weight : 1;
}
