"use client";

/**
 * What the rail shows for a selection: a group, a band, a service or a
 * relationship, else the level's own panel (the routes between two services)
 * when the host gives one. Null when there is nothing to explain, so the
 * canvas takes the full width.
 */

import type { ReactNode } from "react";
import type { NodeArchitectureRole, SystemEdge, SystemGraph, SystemNode } from "@repowise-dev/types";
import { drawnLabel } from "./flow-elements";
import type { LevelView } from "./levels";
import { BandPanel, GroupPanel } from "./system-map-aggregate-panel";
import { SystemMapDrawer, drawerHasSubject, type SystemMapDrawerData } from "./system-map-drawer";
import type { RepoHealth, SystemMapSelection } from "./types";

export interface RailContentArgs {
  graph: SystemGraph;
  levelView: LevelView;
  selection: SystemMapSelection;
  nodesById: ReadonlyMap<string, SystemNode>;
  edgesById: ReadonlyMap<string, SystemEdge>;
  healthByRepo?: ReadonlyMap<string, RepoHealth> | undefined;
  roleByNodeId?: ReadonlyMap<string, NodeArchitectureRole> | undefined;
  drawer?: SystemMapDrawerData | undefined;
  levelRail?: ReactNode;
  onSelect: (selection: SystemMapSelection) => void;
  onOpenGroup: (groupId: string) => void;
}

function aggregateRail(args: RailContentArgs): ReactNode {
  const { levelView, selection, nodesById } = args;
  const lookups = { ...args, onClose: () => args.onSelect(null) };
  if (selection?.type === "group") {
    const g = levelView.nodes.find((n) => n.type === "group" && n.groupId === selection.id);
    return g?.type === "group" ? <GroupPanel {...lookups} group={g} onOpen={() => args.onOpenGroup(g.groupId)} /> : null;
  }
  if (selection?.type === "band") {
    const b = levelView.edges.find((e) => e.id === selection.id);
    if (b?.type !== "band") return null;
    const label = (id: string) => drawnLabel(levelView.nodes.find((n) => n.id === id), nodesById);
    return <BandPanel {...lookups} band={b} sourceLabel={label(b.source)} targetLabel={label(b.target)} />;
  }
  return null;
}

export function railContent(args: RailContentArgs): ReactNode {
  const aggregate = aggregateRail(args);
  if (aggregate) return aggregate;
  const { graph, selection } = args;
  if (!drawerHasSubject(graph, selection)) return args.levelRail ?? null;
  return (
    <SystemMapDrawer
      {...args.drawer}
      selection={selection}
      graph={graph}
      healthByRepo={args.healthByRepo}
      roleByNodeId={args.roleByNodeId}
      onClose={() => args.onSelect(null)}
      onSelect={args.onSelect}
    />
  );
}
