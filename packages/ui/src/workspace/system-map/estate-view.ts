/**
 * Estate and group-open levels (L0, L1): a card per group, a card per
 * ungrouped service, one tray for services with no Runtime or Data link, and
 * one band per ordered pair where an end aggregates. An opened group becomes
 * the container of its service cards. Groups apply only above 40 services
 * with two or more multi-member groups; otherwise the estate is flat. Which
 * services are ranked and which go to the tray never depends on the family
 * filter, so a filter toggle changes only the connectors. Pure, no React.
 */

import { compareIds, connectEdges } from "./bands";
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

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Service id -> group id, for groups with two or more members, or null when
 * the estate is drawn flat (40 services or fewer, or fewer than two
 * multi-member groups). A one-member group's service is drawn bare.
 */
export function activeGroups(graph: LevelsGraph): Map<string, string> | null {
  if (graph.nodes.length <= GROUPING_MIN_SERVICES) return null;
  const members = new Map<string, string[]>();
  for (const n of graph.nodes) if (n.group) push(members, n.group, n.id);
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

/** Services split by where they live before any budget: groups, the root, the tray. */
interface Partition {
  groupOf: Map<string, string> | null;
  /** Group id -> members, most-linked first. */
  members: Map<string, string[]>;
  /** Group ids, most-linked group first. */
  groupIds: string[];
  rootServices: string[];
  trayServices: string[];
}

function partition(graph: LevelsGraph): Partition {
  const groupOf = activeGroups(graph);
  const weights = linkedWeights(graph.edges);
  const weight = (id: string) => weights.get(id) ?? 0;
  const byRank = (a: string, b: string) => weight(b) - weight(a) || compareIds(a, b);
  const members = new Map<string, string[]>();
  const rootServices: string[] = [];
  const trayServices: string[] = [];
  for (const n of graph.nodes) {
    const g = groupOf?.get(n.id);
    if (g !== undefined) push(members, g, n.id);
    else if (weight(n.id) > 0) rootServices.push(n.id);
    else trayServices.push(n.id);
  }
  for (const list of members.values()) list.sort(byRank);
  rootServices.sort(byRank);
  trayServices.sort(byRank);
  const groupIds = [...members]
    .map(([g, ids]) => [g, ids.reduce((sum, id) => sum + weight(id), 0)] as const)
    .sort((a, b) => b[1] - a[1] || compareIds(a[0], b[0]))
    .map(([g]) => g);
  return { groupOf, members, groupIds, rootServices, trayServices };
}

type GroupStats = Map<string, { in: number; out: number; inside: number }>;

/** Links into, out of and inside each group, from the edges rather than the drawing, so open and closed agree. */
function groupLinkStats(visible: readonly LevelsEdge[], groupOf: Map<string, string> | null): GroupStats {
  const stats: GroupStats = new Map();
  if (!groupOf) return stats;
  const stat = (g: string) => {
    let s = stats.get(g);
    if (!s) stats.set(g, (s = { in: 0, out: 0, inside: 0 }));
    return s;
  };
  for (const e of visible) {
    const gs = groupOf.get(e.source);
    const gt = groupOf.get(e.target);
    const w = linkWeight(e);
    if (gs !== undefined && gs === gt) {
      if (e.source !== e.target) stat(gs).inside += w;
      continue;
    }
    if (gs !== undefined) stat(gs).out += w;
    if (gt !== undefined) stat(gt).in += w;
  }
  return stats;
}

/** Where each service is drawn, which ids are their own cards, and what folded. */
interface Placement {
  drawnAt: Map<string, string>;
  cards: Set<string>;
  keptGroups: Set<string>;
  trayCard: boolean;
  rootMore: { services: string[]; groups: string[] };
  /** Open container id -> services folded into its "+N more". */
  openFolded: Map<string, string[]>;
}

function rootItemTarget(item: RootItem): string {
  if (item.kind === "group") return groupNodeId(item.id);
  return item.kind === "tray" ? TRAY_NODE_ID : item.id;
}

function rootItemServices(p: Partition, item: RootItem): readonly string[] {
  if (item.kind === "group") return p.members.get(item.id)!;
  return item.kind === "tray" ? p.trayServices : [item.id];
}

/** The first `keep` root items are drawn; the rest fold into the estate's "+N more". */
function placeRoot(p: Partition, items: readonly RootItem[], keep: number, out: Placement): void {
  items.forEach((item, index) => {
    const isKept = index < keep;
    const services = rootItemServices(p, item);
    const at = isKept ? rootItemTarget(item) : ESTATE_MORE_ID;
    for (const id of services) out.drawnAt.set(id, at);
    if (!isKept) {
      out.rootMore.services.push(...services);
      if (item.kind === "group") out.rootMore.groups.push(item.id);
    } else if (item.kind === "group") out.keptGroups.add(item.id);
    else if (item.kind === "tray") out.trayCard = true;
    else out.cards.add(item.id);
  });
}

/** Kept members become cards inside the container, the rest fold into its "+N more". */
function placeOpen(containerId: string, ids: readonly string[], keep: number, moreId: string, out: Placement): void {
  ids.forEach((id, i) => {
    out.drawnAt.set(id, i < keep ? id : moreId);
    if (i < keep) out.cards.add(id);
  });
  out.openFolded.set(containerId, ids.slice(keep));
}

const limited = (size: number): BudgetContainer =>
  size > OPEN_GROUP_LIMIT.over ? { size, limit: OPEN_GROUP_LIMIT.keep } : { size };

/** The estate, with any opened groups and the tray, drawing only `visible` edges. */
export function buildEstateView(
  graph: LevelsGraph,
  state: LevelViewState,
  visible: readonly LevelsEdge[],
  edgesById: ReadonlyMap<string, LevelsEdge>,
  budget: DrawBudget,
): EstateView {
  const p = partition(graph);
  const { members, groupIds, rootServices, trayServices } = p;
  const opened = new Set([...(state.open ?? [])].filter((g) => members.has(g)));
  const trayOpen = Boolean(state.openTray) && trayServices.length > 0;
  const openGroups = groupIds.filter((g) => opened.has(g));

  // Budget containers: the root (closed group cards, then the tray card, then
  // services, in fold priority), each open group, and the open tray.
  const rootItems: RootItem[] = [
    ...groupIds.filter((g) => !opened.has(g)).map((id) => ({ kind: "group" as const, id })),
    ...(trayServices.length > 0 && !trayOpen ? [{ kind: "tray" as const }] : []),
    ...rootServices.map((id) => ({ kind: "service" as const, id })),
  ];
  const containers: BudgetContainer[] = [
    { size: rootItems.length },
    ...openGroups.map((g) => limited(members.get(g)!.length)),
    ...(trayOpen ? [limited(trayServices.length)] : []),
  ];
  const kept = allocateSlots(containers, budget.nodes - openGroups.length - (trayOpen ? 1 : 0));

  const placed: Placement = {
    drawnAt: new Map(),
    cards: new Set(),
    keptGroups: new Set(),
    trayCard: false,
    rootMore: { services: [], groups: [] },
    openFolded: new Map(),
  };
  placeRoot(p, rootItems, kept[0]!, placed);
  openGroups.forEach((g, i) => placeOpen(groupNodeId(g), members.get(g)!, kept[i + 1]!, groupMoreId(g), placed));
  if (trayOpen) placeOpen(TRAY_NODE_ID, trayServices, kept[kept.length - 1]!, TRAY_MORE_ID, placed);

  const edges = connectEdges(visible, (id) => placed.drawnAt.get(id) ?? null, (id) => placed.cards.has(id));
  const capped = capEdges(edges, budget.edges, edgesById);
  const stats = groupLinkStats(visible, p.groupOf);
  const nodes = assembleNodes(graph, p, { opened, trayOpen, stats, placed });

  let foldedServices = placed.rootMore.services.length;
  for (const f of placed.openFolded.values()) foldedServices += f.length;
  return {
    level: opened.size > 0 || trayOpen ? "group" : "estate",
    grouped: p.groupOf !== null,
    nodes,
    edges: capped.edges,
    truncation: truncationReport(
      budget,
      foldedServices,
      placed.rootMore.groups.length,
      capped.droppedEdges,
      capped.droppedLinks,
    ),
  };
}

interface AssembleArgs {
  opened: ReadonlySet<string>;
  trayOpen: boolean;
  stats: GroupStats;
  placed: Placement;
}

function groupCard(graph: LevelsGraph, p: Partition, g: string, open: boolean, stats: GroupStats): DrawnGroupNode {
  const meta = graph.groups?.find((m) => m.id === g);
  const ids = p.members.get(g)!;
  const repos = new Set(graph.nodes.filter((n) => p.groupOf?.get(n.id) === g).map((n) => n.repo));
  const s = stats.get(g);
  return {
    type: "group",
    id: groupNodeId(g),
    groupId: g,
    label: meta?.label || g,
    source: meta?.source ?? null,
    open,
    serviceIds: ids,
    repoCount: repos.size,
    linksIn: s?.in ?? 0,
    linksOut: s?.out ?? 0,
    linksInside: s?.inside ?? 0,
  };
}

/**
 * Output order is stable across open/close: groups by weight (an open one
 * followed by its children, as React Flow needs parents first), the tray,
 * ungrouped services, then the estate's "+N more".
 */
function assembleNodes(graph: LevelsGraph, p: Partition, args: AssembleArgs): DrawnNode[] {
  const { opened, trayOpen, stats, placed } = args;
  const nodes: DrawnNode[] = [];
  const pushChildren = (ids: readonly string[], parentId: string, moreId: string) => {
    for (const id of ids) if (placed.cards.has(id)) nodes.push({ type: "service", id, serviceId: id, parentId });
    const folded = placed.openFolded.get(parentId) ?? [];
    if (folded.length > 0) nodes.push({ type: "more", id: moreId, parentId, serviceIds: folded, groupIds: [] });
  };
  for (const g of p.groupIds) {
    if (opened.has(g)) {
      nodes.push(groupCard(graph, p, g, true, stats));
      pushChildren(p.members.get(g)!, groupNodeId(g), groupMoreId(g));
    } else if (placed.keptGroups.has(g)) nodes.push(groupCard(graph, p, g, false, stats));
  }
  if (trayOpen || placed.trayCard) {
    nodes.push({ type: "tray", id: TRAY_NODE_ID, open: trayOpen, serviceIds: p.trayServices });
    if (trayOpen) pushChildren(p.trayServices, TRAY_NODE_ID, TRAY_MORE_ID);
  }
  for (const id of p.rootServices) {
    if (placed.cards.has(id)) nodes.push({ type: "service", id, serviceId: id, parentId: null });
  }
  const more = placed.rootMore;
  if (more.services.length > 0) {
    nodes.push({ type: "more", id: ESTATE_MORE_ID, parentId: null, serviceIds: more.services, groupIds: more.groups });
  }
  return nodes;
}
