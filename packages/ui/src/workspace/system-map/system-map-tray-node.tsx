"use client";

/**
 * The two aggregates that are not systems. The tray holds the services with
 * no Runtime or Data link at all, as one card or (open) the container of
 * their cards. A "+N more" card stands for what the draw budget folded. Both
 * are dashed: they collect services by what the map can say about them, not
 * by anything the services share.
 */

import { memo, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { MoreNodeData, TrayNodeData } from "./flow-elements";
import { LEVEL_NODE_SIZES } from "./layout-scopes";
import { useSystemMapActions } from "./system-map-actions";
import { plural } from "./system-map-model";
import { TRAY_OPEN_TOKEN } from "./view-state";

const MONO: CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: 10,
  lineHeight: "14px",
  color: "var(--color-text-secondary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const HIDDEN_HANDLE: CSSProperties = { opacity: 0, pointerEvents: "none" };

function dashed(selected: boolean): CSSProperties {
  return {
    boxSizing: "border-box",
    borderRadius: 8,
    border: `1px dashed ${selected ? "var(--color-accent-primary)" : "var(--color-border-hover)"}`,
    background: "transparent",
  };
}

function Action({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="nodrag nopan"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", fontSize: 12, lineHeight: "16px", fontWeight: 500, color: "var(--color-accent-primary)" }}
    >
      {label}
    </button>
  );
}

function TrayNodeInner({ data, selected }: NodeProps) {
  const { tray, names } = data as unknown as TrayNodeData;
  const actions = useSystemMapActions();
  const count = tray.serviceIds.length;

  if (tray.open) {
    return (
      <div style={{ ...dashed(Boolean(selected)), width: "100%", height: "100%", padding: "10px 14px", borderRadius: 10 }}>
        <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>Not linked at runtime</span>
          <span style={{ ...MONO, flexShrink: 0 }}>{plural(count, "service", "services")}</span>
          <span style={{ flex: 1 }} />
          <Action label="Close" onClick={() => actions.closeContainer(TRAY_OPEN_TOKEN)} />
        </div>
        <Handle type="source" position={Position.Bottom} style={HIDDEN_HANDLE} />
      </div>
    );
  }

  const { width, height } = LEVEL_NODE_SIZES.tray;
  const rest = count - names.length;
  return (
    <div
      style={{ ...dashed(Boolean(selected)), width, height, display: "flex", flexDirection: "column", gap: 2, padding: "9px 12px", cursor: "pointer" }}
    >
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE} />
      <span style={{ fontSize: 12, lineHeight: "16px", fontWeight: 600, color: "var(--color-text-primary)" }}>
        Not linked at runtime · <span style={{ fontVariantNumeric: "tabular-nums" }}>{count.toLocaleString()}</span>
      </span>
      <span style={MONO} title={names.join(", ")}>
        {names.join(", ")}
        {rest > 0 ? `, +${rest.toLocaleString()} more` : ""}
      </span>
      <span style={{ fontSize: 12, lineHeight: "16px", color: "var(--color-text-secondary)" }}>No runtime or data link.</span>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "auto" }}>
        <Action label="Open ›" onClick={() => actions.openContainer(TRAY_OPEN_TOKEN)} />
      </div>
      <Handle type="source" position={Position.Bottom} style={HIDDEN_HANDLE} />
    </div>
  );
}

function MoreNodeInner({ data, selected }: NodeProps) {
  const { more } = data as unknown as MoreNodeData;
  const { showFolded } = useSystemMapActions();
  const { width, height } = LEVEL_NODE_SIZES.more;
  const groups = more.groupIds.length;
  return (
    <div style={{ ...dashed(Boolean(selected)), width, height, display: "flex", flexDirection: "column", gap: 3, padding: "9px 12px" }}>
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE} />
      <span style={{ fontSize: 15, lineHeight: "20px", fontWeight: 600, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
        +{more.serviceIds.length.toLocaleString()} more
      </span>
      <span style={{ fontSize: 12, lineHeight: "16px", color: "var(--color-text-secondary)" }}>
        {groups > 0 ? `${plural(groups, "group", "groups")} and their services, ` : "Services "}
        folded to keep the map within its draw budget.
      </span>
      {showFolded && (
        <div style={{ marginTop: "auto" }}>
          <Action label="List them" onClick={() => showFolded(more.serviceIds)} />
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={HIDDEN_HANDLE} />
    </div>
  );
}

export const SystemMapTrayNode = memo(TrayNodeInner);
export const SystemMapMoreNode = memo(MoreNodeInner);
