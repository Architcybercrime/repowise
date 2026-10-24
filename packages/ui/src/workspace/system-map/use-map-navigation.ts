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

/** Everything a shortcut can act on. */
interface ShortcutContext {
  view: MapViewState;
  setView: (next: MapViewState) => void;
  selection: SystemMapSelection;
  clearSelection: () => void;
  display: MapDisplay;
  setDisplay: (display: MapDisplay) => void;
  toMap: (next: MapViewState) => MapViewState;
  help: boolean;
  setHelp: Dispatch<SetStateAction<boolean>>;
  pendingFrom: string | null;
  setPendingFrom: (id: string | null) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}

/** Escape: the help, then a pending pick, then the selection, then one level up (on the map only). */
function backOne(c: ShortcutContext): boolean {
  if (c.help) c.setHelp(false);
  else if (c.pendingFrom) c.setPendingFrom(null);
  else if (c.selection) c.clearSelection();
  else {
    const up = c.display === "map" ? backOut(c.view) : null;
    if (!up) return false;
    c.setView(up);
  }
  return true;
}

/** What each shortcut does; each returns whether it acted, and a shortcut that did nothing leaves the key alone. */
function shortcutHandlers(c: ShortcutContext): Record<MapShortcut, () => boolean> {
  const node = c.selection?.type === "node" ? c.selection.id : null;
  return {
    search: () => {
      c.searchRef.current?.focus();
      return true;
    },
    help: () => {
      c.setHelp((open) => !open);
      return true;
    },
    list: () => {
      c.setDisplay(c.display === "list" ? "map" : "list");
      return true;
    },
    focus: () => {
      if (node) c.setView(c.toMap(focusService(c.view, node)));
      return node !== null;
    },
    between: () => {
      if (node) c.setPendingFrom(c.pendingFrom === node ? null : node);
      return node !== null;
    },
    back: () => backOne(c),
  };
}

/** Binds the shortcuts on the window once; the listener reads the latest handlers through a ref. */
function useShortcutKeys(handlers: Record<MapShortcut, () => boolean>): void {
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
}

/**
 * The two-step Between pick: `b` holds a service, and the next service
 * selected anywhere (canvas, list or rail) completes the comparison. Clearing
 * the selection drops a pending pick.
 */
function useBetweenPick(state: SystemMapState, toMap: (next: MapViewState) => MapViewState) {
  const { view, setView, selection } = state;
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  useEffect(() => {
    if (!selection) setPendingFrom(null);
  }, [selection]);
  const setSelection = useCallback(
    (next: SystemMapSelection) => {
      if (!pendingFrom || next?.type !== "node" || next.id === pendingFrom) return state.setSelection(next);
      setPendingFrom(null);
      state.setSelection(null);
      setView(toMap(compareServices(view, pendingFrom, next.id)));
    },
    [pendingFrom, state, setView, view, toMap],
  );
  return { pendingFrom, setPendingFrom, setSelection };
}

export function useMapNavigation(state: SystemMapState): MapNavigation {
  const { view, setView } = state;
  const narrow = useNarrowViewport();
  const display: MapDisplay = view.display ?? (narrow ? "list" : "map");
  const [help, setHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const toMap = useCallback((next: MapViewState) => (display === "list" ? withDisplay(next, "map") : next), [display]);
  const setDisplay = useCallback((d: MapDisplay) => setView(withDisplay(view, d)), [setView, view]);
  const pick = useBetweenPick(state, toMap);

  const onSearchPick = useCallback(
    (hit: SearchHit) => {
      state.setSelection(null);
      setView(toMap(pickToView(view, hit)));
    },
    [state, setView, view, toMap],
  );

  const ctx: ShortcutContext = {
    view,
    setView,
    selection: state.selection,
    clearSelection: () => state.setSelection(null),
    display,
    setDisplay,
    toMap,
    help,
    setHelp,
    pendingFrom: pick.pendingFrom,
    setPendingFrom: pick.setPendingFrom,
    searchRef,
  };
  useShortcutKeys(shortcutHandlers(ctx));

  return {
    display,
    setDisplay,
    pendingFrom: pick.pendingFrom,
    setSelection: pick.setSelection,
    help,
    setHelp,
    searchRef,
    onSearchPick,
    back: () => backOne(ctx),
  };
}
