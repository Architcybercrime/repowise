"use client";

/**
 * The map's navigation state over the level state and the selection: the
 * Map | List display (the table by default on phones), the two-step Between
 * pick (`b` on a service, then a second service), the shortcut help, the
 * search input's ref, and the keyboard shortcuts bound while the map is on
 * screen. Anything that lands on a level shows the map.
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { claimCommandPaletteShortcut } from "../../lib/command-palette-scope";
import type { SearchHit } from "./search-index";
import { pickToView } from "./search-index";
import { shortcutFor, type MapShortcut } from "./shortcuts";
import type { SystemMapSelection } from "./types";
import type { SystemMapState } from "./use-system-map-state";
import { backOut, compareServices, focusService, withDisplay, type MapDisplay, type MapViewState } from "./view-state";

/** Below Tailwind's `sm`, where the table reads better than the canvas. */
const NARROW = "(max-width: 639px)";

/** False on the server and the first client render, so both agree; the effect corrects it. */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(NARROW);
    setNarrow(mq.matches);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export interface MapNavigation {
  display: MapDisplay;
  setDisplay: (display: MapDisplay) => void;
  /** Service picked with `b`, waiting for the second. */
  pendingFrom: string | null;
  /** The selection setter every input should use: it completes a pending Between pick. */
  setSelection: (next: SystemMapSelection) => void;
  help: boolean;
  setHelp: Dispatch<SetStateAction<boolean>>;
  searchRef: RefObject<HTMLInputElement | null>;
  /** Escape, wherever it is pressed: the help, then a pending pick, then the selection, then a level. */
  back: () => boolean;
  onSearchPick: (hit: SearchHit) => void;
}

export function useMapNavigation(state: SystemMapState): MapNavigation {
  const { view, setView, selection } = state;
  const narrow = useNarrowViewport();
  const display: MapDisplay = view.display ?? (narrow ? "list" : "map");
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const toMap = useCallback((next: MapViewState) => (display === "list" ? withDisplay(next, "map") : next), [display]);
  const setDisplay = useCallback((d: MapDisplay) => setView(withDisplay(view, d)), [setView, view]);

  const setSelection = useCallback(
    (next: SystemMapSelection) => {
      if (pendingFrom && next?.type === "node" && next.id !== pendingFrom) {
        setPendingFrom(null);
        state.setSelection(null);
        setView(toMap(compareServices(view, pendingFrom, next.id)));
        return;
      }
      state.setSelection(next);
    },
    [pendingFrom, state, setView, view, toMap],
  );

  const onSearchPick = useCallback(
    (hit: SearchHit) => {
      setPendingFrom(null);
      state.setSelection(null);
      setView(toMap(pickToView(view, hit)));
    },
    [state, setView, view, toMap],
  );

  const node = selection?.type === "node" ? selection.id : null;
  /** Escape: the help, then a pending pick, then the selection, then one level up (on the map). */
  const back = (): boolean => {
    if (help) setHelp(false);
    else if (pendingFrom) setPendingFrom(null);
    else if (selection) state.setSelection(null);
    else {
      const up = display === "map" ? backOut(view) : null;
      if (!up) return false;
      setView(up);
    }
    return true;
  };
  // Each returns whether it acted; a shortcut that did nothing leaves the key alone.
  const handlers: Record<MapShortcut, () => boolean> = {
    search: () => {
      searchRef.current?.focus();
      return true;
    },
    help: () => {
      setHelp((open) => !open);
      return true;
    },
    list: () => {
      setDisplay(display === "list" ? "map" : "list");
      return true;
    },
    focus: () => {
      if (node) setView(toMap(focusService(view, node)));
      return node !== null;
    },
    between: () => {
      if (node) setPendingFrom(pendingFrom === node ? null : node);
      return node !== null;
    },
    back,
  };
  // Bound once; the listener reads the latest handlers through the ref.
  const live = useRef(handlers);
  live.current = handlers;
  useEffect(() => {
    // Ctrl/Cmd+K searches the map while it is on screen, so the app-wide palette stands down.
    const release = claimCommandPaletteShortcut("system-map");
    const onKeyDown = (e: KeyboardEvent) => {
      const action = shortcutFor(e);
      if (action && live.current[action]()) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      release();
    };
  }, []);

  return { display, setDisplay, pendingFrom, setSelection, help, setHelp, searchRef, onSearchPick, back };
}
