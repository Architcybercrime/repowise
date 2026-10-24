/**
 * Render-budget bench for the System Map's pure functions, over seeded
 * synthetic estates at four sizes (ten edges per service, a group per ten
 * services). Run with `npm run bench --workspace @repowise-dev/ui`.
 *
 * Add each new pure system-map function to `suite` below; the sizes and the
 * graphs are shared so every row is comparable.
 */

import { bench, describe } from "vitest";
import type { SystemEdgeKind } from "@repowise-dev/types";
import { applyView, computeSystemMapPositions, layoutSignature } from "../../src/workspace/system-map/layout";
import { collapseToRepos } from "../../src/workspace/system-map/collapse";
import { neighbourGroups, serviceResolver } from "../../src/workspace/system-map/system-map-model";
import { buildLevelView } from "../../src/workspace/system-map/levels";
import { allocateSlots } from "../../src/workspace/system-map/draw-budget";
import { servicesBetween } from "../../src/workspace/system-map/between";
import type { LevelsGraph } from "../../src/workspace/system-map/level-types";
import { makeSyntheticSystemGraph } from "./fixtures/synthetic-system-graph";

const SIZES = [30, 100, 300, 1000] as const;
const RUNTIME_KINDS = new Set<SystemEdgeKind>(["http", "grpc", "socket", "event", "db"]);
/** ELK runs for seconds at the top sizes; a few samples are enough there. */
const SLOW = { iterations: 3, time: 0, warmupIterations: 1 } as const;

for (const services of SIZES) {
  const graph = makeSyntheticSystemGraph({
    services,
    edges: services * 10,
    groups: Math.max(1, Math.round(services / 10)),
    seed: services,
  });
  const hub = graph.edges.find((e) => e.kind === "package")?.target ?? graph.nodes[0]!.id;
  // The grouped payload the levels model reads: `group` on nodes plus the `groups` list.
  const groupIds = [...new Set(graph.nodes.map((n) => n.group).filter((g): g is string => Boolean(g)))];
  const levels: LevelsGraph = { ...graph, groups: groupIds.map((id) => ({ id })) };
  const caller = graph.edges.find((e) => e.kind === "http")?.source ?? graph.nodes[0]!.id;
  const callee = graph.edges.find((e) => e.kind === "http")?.target ?? graph.nodes[1]!.id;
  const containers = groupIds.map((_, i) => ({ size: 5 + ((i * 7) % 40) }));

  describe(`system map, ${services} services / ${graph.edges.length} edges`, () => {
    bench("applyView (runtime kinds)", () => {
      applyView(graph, { visibleKinds: RUNTIME_KINDS, collapsed: false });
    });
    bench("collapseToRepos", () => {
      collapseToRepos(graph);
    });
    bench("layoutSignature", () => {
      layoutSignature(graph);
    });
    bench("serviceResolver + neighbourGroups (hub, both ways)", () => {
      serviceResolver(graph, false);
      neighbourGroups(graph, hub, "in");
      neighbourGroups(graph, hub, "out");
    });
    bench("buildLevelView estate (cold payload, normalizes)", () => {
      buildLevelView({ ...levels });
    });
    bench("buildLevelView open group (cached payload)", () => {
      buildLevelView(levels, { open: groupIds.slice(0, 1) });
    });
    bench("buildLevelView focus, two hops (cached payload)", () => {
      buildLevelView(levels, { focus: hub, hops: 2 });
    });
    bench("allocateSlots (one container per group)", () => {
      allocateSlots(containers, 119);
    });
    bench("servicesBetween (runtime pair)", () => {
      servicesBetween(levels, caller, callee);
    });
    bench("computeSystemMapPositions (ELK, grid past 500)", async () => {
      await computeSystemMapPositions(graph);
    }, SLOW);
  });
}
