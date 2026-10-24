"use client";

/**
 * Positions for a drawn levels view (`buildLevelView`), laid out off the main
 * thread and cached per scope for the life of one graph. Keyed on what shapes
 * the layout, so a family toggle or a lens change that leaves the drawn cards
 * alone runs nothing. While a new layout is pending the previous positions
 * stay, so cards already on screen do not jump; ids new to the view have no
 * entry until it lands.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { C4LayoutPosition } from "../../c4/layout/elk-c4-layout";
import { createLayoutCache, computeLevelLayout, levelLayoutInput, type LevelPositions } from "./level-layout";
import { LEVEL_NODE_SIZES, planSignature, type LevelNodeSizes } from "./layout-scopes";
import type { LevelView } from "./levels";
import type { LevelsGraph } from "./level-types";

export interface UseLevelLayoutArgs {
  /** The graph the view was built from; its edges shape placement. */
  graph: LevelsGraph | null;
  view: LevelView | null;
  sizes?: LevelNodeSizes;
}

export interface LevelLayout {
  positions: ReadonlyMap<string, C4LayoutPosition> | null;
  /** True from the render a new layout is asked for until it lands or fails. */
  loading: boolean;
  /** The last layout failed; `positions` are those of the view before it. */
  failed: boolean;
}

export function useLevelLayout({ graph, view, sizes = LEVEL_NODE_SIZES }: UseLevelLayoutArgs): LevelLayout {
  const input = useMemo(
    () => (graph && view ? levelLayoutInput(view, graph.edges, sizes) : null),
    [graph, view, sizes],
  );
  const key = useMemo(() => {
    if (!input) return null;
    if (input.kind === "columns") {
      const { width, height } = sizes.service;
      return `columns:${width}x${height}\n${input.view.nodes.map((n) => n.id).join("|")}`;
    }
    return planSignature(input.plan);
  }, [input, sizes]);

  const cache = useRef(createLayoutCache());
  const previous = useRef<LevelPositions | undefined>(undefined);
  const cachedGraph = useRef(graph);
  if (cachedGraph.current !== graph) {
    cachedGraph.current = graph;
    cache.current = createLayoutCache();
    previous.current = undefined;
  }
  const latestInput = useRef(input);
  latestInput.current = input;

  // The key the shown positions belong to; loading is derived, so it is true
  // on the very render the key changes rather than one commit later.
  const [settled, setSettled] = useState<{ key: string | null; positions: LevelPositions | null; failed: boolean }>(
    { key: null, positions: null, failed: false },
  );

  useEffect(() => {
    const current = latestInput.current;
    if (!current || key === null) {
      setSettled({ key, positions: null, failed: false });
      return;
    }
    let cancelled = false;
    computeLevelLayout(current, { cache: cache.current, previous: previous.current, sizes }).then(
      (result) => {
        if (cancelled) return;
        previous.current = result;
        setSettled({ key, positions: result, failed: false });
      },
      () => {
        if (!cancelled) setSettled((s) => ({ key, positions: s.positions, failed: true }));
      },
    );
    return () => {
      cancelled = true;
    };
    // `key` stands for `input` and `sizes`: equal keys lay out alike.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { positions: settled.positions, loading: settled.key !== key, failed: settled.failed };
}
