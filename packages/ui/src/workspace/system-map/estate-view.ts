/**
 * Estate and group-open levels (L0, L1): a card per group, a card per
 * ungrouped service, one tray for services with no Runtime or Data link, and
 * one band per ordered pair where an end aggregates. An opened group becomes
 * the container of its service cards. Groups apply only above 40 services
 * with two or more multi-member groups; otherwise the estate is flat. Which
 * services are ranked and which go to the tray never depends on the family
 * filter, so a filter toggle changes only the connectors. Pure, no React.
 */

import { connectEdges } from "./bands";
import { allocateSlots, capEdges, truncationReport, type BudgetContainer } from "./draw-budget";
import { LINKED_FAMILIES, edgeFamily, linkWeight } from "./edge-families";
import type {
  DrawBudget,
  DrawnEdge,
  DrawnGroupNode,
  DrawnNode,
  LevelViewState,
  LevelsEdge,
  LevelsGraph,
  MapLevel,
  TruncationReport,
} from "./level-types";

/** Groups apply only above this many services. */
export const GROUPING_MIN_SERVICES = 40;
/** An opened group over `over` services draws its `keep` most-linked plus "+N more". */
export const OPEN_GROUP_LIMIT = { over: 40, keep: 30 } as const;

export const TRAY_NODE_ID = "tray:";
export const ESTATE_MORE_ID = "more:estate";

export function groupNodeId(groupId: string): string {
  return `group:${groupId}`;
}

function groupMoreId(groupId: string): string {
  return `more:group:${groupId}`;
}

const TRAY_MORE_ID = "more:tray";

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Service id -> group id, for groups with two or more members, or null when
 * the estate is drawn flat (40 services or fewer, or fewer than two
 * multi-member groups). A one-member group's service is drawn bare.
 */
export function activeGroups(graph: LevelsGraph): Map<string, string> | null {
  if (graph.nodes.length <= GROUPING_MIN_SERVICES) return null;
  const members = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (!n.group) continue;
    let list = members.get(n.group);
    if (!list) members.set(n.group, (list = []));
    list.push(n.id);
  }
  const out = new Map<string, string>();
  let multi = 0;
  for (const [group, ids] of members) {
    if (ids.length < 2) continue;
    multi += 1;
    for (const id of ids) out.set(id, group);
  }
  return multi >= 2 ? out : null;
}

/** Links per service over the fixed linked families (Runtime and Data), both directions. */
export function linkedWeights(edges: Iterable<LevelsEdge>): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of edges) {
    if (e.source === e.target || !LINKED_FAMILIES.has(edgeFamily(e.kind))) continue;
    const w = linkWeight(e);
    out.set(e.source, (out.get(e.source) ?? 0) + w);
    out.set(e.target, (out.get(e.target) ?? 0) + w);
  }
  return out;
}

export interface EstateView {
  level: Extract<MapLevel, "estate" | "group">;
  grouped: boolean;
  nodes: DrawnNode[];
  edges: DrawnEdge[];
  truncation: TruncationReport | null;
}

type RootItem = { kind: "group"; id: string } | { kind: "tray" } | { kind: "service"; id: string };

/** The estate, with any opened groups and the tray, drawing only `visible` edges. */
export function buildEstateView(
  graph: LevelsGraph,
  state: LevelViewState,
  visible: readonly LevelsEdge[],
  edgesById: ReadonlyMap<string, LevelsEdge>,
  budget: DrawBudget,
): EstateView {
  const groupOf = activeGroups(graph);
  const weights = linkedWeights(graph.edges);
  const weight = (id: string) => weights.get(id) ?? 0;
  const byRank = (a: string, b: string) => weight(b) - weight(a) || byId(a, b);

  // Partition: group members, ungrouped linked services (root), ungrouped unlinked (tray).
  const members = new Map<string, string[]>();
  const rootServices: string[] = [];
  const trayServices: string[] = [];
  for (const n of graph.nodes) {
    const g = groupOf?.get(n.id);
    if (g !== undefined) {
      let list = members.get(g);
      if (!list) members.set(g, (list = []));
      list.push(n.id);
    } else if (weight(n.id) > 0) rootServices.push(n.id);
    else trayServices.push(n.id);
  }
  for (const list of members.values()) list.sort(byRank);
  rootServices.sort(byRank);
  trayServices.sort(byRank);
  const groupWeight = new Map([...members].map(([g, ids]) => [g, ids.reduce((s, id) => s + weight(id), 0)]));
  const groupIds = [...members.keys()].sort((a, b) => groupWeight.get(b)! - groupWeight.get(a)! || byId(a, b));
  const opened = new Set([...(state.open ?? [])].filter((g) => members.has(g)));
  const trayOpen = Boolean(state.openTray) && trayServices.length > 0;

  // Budget containers: the root (closed group cards, then the tray card, then
  // services, in fold priority), each open group, and the open tray.
  const rootItems: RootItem[] = [
    ...groupIds.filter((g) => !opened.has(g)).map((id) => ({ kind: "group" as const, id })),
    ...(trayServices.length > 0 && !trayOpen ? [{ kind: "tray" as const }] : []),
    ...rootServices.map((id) => ({ kind: "service" as const, id })),
  ];
  const openGroups = groupIds.filter((g) => opened.has(g));
  const limited = (size: number): BudgetContainer =>
    size > OPEN_GROUP_LIMIT.over ? { size, limit: OPEN_GROUP_LIMIT.keep } : { size };
  const containers: BudgetContainer[] = [
    { size: rootItems.length },
    ...openGroups.map((g) => limited(members.get(g)!.length)),
    ...(trayOpen ? [limited(trayServices.length)] : []),
  ];
  const fixed = openGroups.length + (trayOpen ? 1 : 0);
  const kept = allocateSlots(containers, budget.nodes - fixed);

  const drawnAt = new Map<string, string>();
  const cards = new Set<string>();
  const rootMore = { services: [] as string[], groups: [] as string[] };
  const keptGroups = new Set<string>();
  let trayCard = false;
  rootItems.forEach((item, index) => {
    const isKept = index < kept[0]!;
    if (item.kind === "group") {
      for (const id of members.get(item.id)!) drawnAt.set(id, isKept ? groupNodeId(item.id) : ESTATE_MORE_ID);
      if (isKept) keptGroups.add(item.id);
      else {
        rootMore.groups.push(item.id);
        rootMore.services.push(...members.get(item.id)!);
      }
    } else if (item.kind === "tray") {
      for (const id of trayServices) drawnAt.set(id, isKept ? TRAY_NODE_ID : ESTATE_MORE_ID);
      trayCard = isKept;
      if (!isKept) rootMore.services.push(...trayServices);
    } else {
      drawnAt.set(item.id, isKept ? item.id : ESTATE_MORE_ID);
      if (isKept) cards.add(item.id);
      else rootMore.services.push(item.id);
    }
  });
  // Open containers: kept members are cards inside, the rest fold into the container's "+N more".
  const fill = (ids: string[], keep: number, moreId: string) => {
    ids.forEach((id, i) => {
      drawnAt.set(id, i < keep ? id : moreId);
      if (i < keep) cards.add(id);
    });
    return ids.slice(keep);
  };
  const openFolded = new Map<string, string[]>();
  openGroups.forEach((g, i) => openFolded.set(g, fill(members.get(g)!, kept[i + 1]!, groupMoreId(g))));
  const trayFolded = trayOpen ? fill(trayServices, kept[kept.length - 1]!, TRAY_MORE_ID) : [];

  const { edges } = connectEdges(visible, (id) => drawnAt.get(id) ?? null, (id) => cards.has(id));
  const capped = capEdges(edges, budget.edges, edgesById);

  // Group link counts come from the edges, not the drawing, so an open
  // container and a closed card report the same numbers.
  const stats = new Map<string, { in: number; out: number; inside: number }>();
  const stat = (g: string) => {
    let s = stats.get(g);
    if (!s) stats.set(g, (s = { in: 0, out: 0, inside: 0 }));
    return s;
  };
  for (const e of visible) {
    const gs = groupOf?.get(e.source);
    const gt = groupOf?.get(e.target);
    const w = linkWeight(e);
    if (gs !== undefined && gs === gt) {
      if (e.source !== e.target) stat(gs).inside += w;
      continue;
    }
    if (gs !== undefined) stat(gs).out += w;
    if (gt !== undefined) stat(gt).in += w;
  }
  const meta = new Map((graph.groups ?? []).map((m) => [m.id, m]));
  const repoOf = new Map(graph.nodes.map((n) => [n.id, n.repo]));
  const groupNode = (g: string, open: boolean): DrawnGroupNode => {
    const ids = members.get(g)!;
    const s = stats.get(g);
    return {
      type: "group",
      id: groupNodeId(g),
      groupId: g,
      label: meta.get(g)?.label || g,
      source: meta.get(g)?.source ?? null,
      open,
      serviceIds: ids,
      repoCount: new Set(ids.map((id) => repoOf.get(id))).size,
      linksIn: s?.in ?? 0,
      linksOut: s?.out ?? 0,
      linksInside: s?.inside ?? 0,
    };
  };

  // Output order is stable across open/close: groups by weight (an open one
  // followed by its children), the tray, ungrouped services, then "+N more".
  const nodes: DrawnNode[] = [];
  const pushChildren = (ids: string[], folded: string[], parentId: string, moreId: string) => {
    for (const id of ids) if (cards.has(id)) nodes.push({ type: "service", id, serviceId: id, parentId });
    if (folded.length > 0) nodes.push({ type: "more", id: moreId, parentId, serviceIds: folded, groupIds: [] });
  };
  for (const g of groupIds) {
    if (opened.has(g)) {
      nodes.push(groupNode(g, true));
      pushChildren(members.get(g)!, openFolded.get(g)!, groupNodeId(g), groupMoreId(g));
    } else if (keptGroups.has(g)) {
      nodes.push(groupNode(g, false));
    }
  }
  if (trayOpen) {
    nodes.push({ type: "tray", id: TRAY_NODE_ID, open: true, serviceIds: trayServices });
    pushChildren(trayServices, trayFolded, TRAY_NODE_ID, TRAY_MORE_ID);
  } else if (trayCard) {
    nodes.push({ type: "tray", id: TRAY_NODE_ID, open: false, serviceIds: trayServices });
  }
  for (const id of rootServices) if (cards.has(id)) nodes.push({ type: "service", id, serviceId: id, parentId: null });
  if (rootMore.services.length > 0) {
    nodes.push({ type: "more", id: ESTATE_MORE_ID, parentId: null, serviceIds: rootMore.services, groupIds: rootMore.groups });
  }

  let foldedServices = rootMore.services.length + trayFolded.length;
  for (const f of openFolded.values()) foldedServices += f.length;
  return {
    level: opened.size > 0 || trayOpen ? "group" : "estate",
    grouped: groupOf !== null,
    nodes,
    edges: capped.edges,
    truncation: truncationReport(budget, foldedServices, rootMore.groups.length, capped.droppedEdges, capped.droppedLinks),
  };
}
