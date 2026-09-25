import { useCallback, useEffect, useMemo, useRef, type Dispatch } from "react";
import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { ArrowUUpLeft, ArrowUUpRight, CornersOut, MagnifyingGlassMinus, MagnifyingGlassPlus } from "@phosphor-icons/react";
import type { CanvasNodeKind } from "@boomerang/core";
import { CANVAS_NODE_KINDS } from "@boomerang/core";
import { isPickerOpen, isTypingTarget } from "../../lib/keys";
import { Picker } from "../Picker";
import { CanvasContext, nodeTypes, type CanvasOptions, type RuleNode } from "./nodes";
import { buildNode, newId, placeNear, reducer, type CanvasAction, type CanvasState } from "./store";
import { KIND_FAMILY, KIND_KEY, KIND_LABEL, actionSentence, conditionSentence, eventSentence, scheduleSentence, type Names } from "./vocab";

/**
 * The rule canvas on React Flow: the four custom nodes, smooth step edges, a grid in the
 * line colour, the palette on the right edge, the zoom controls bottom left, and the
 * keyboard: e, c, a, s add a node next to the selection and connect it; Delete removes;
 * arrows nudge 8px (the snap grid); Tab moves between nodes; Enter opens the focused
 * node's first Picker; Ctrl or Cmd Z and Shift undo and redo.
 */

export interface RuleCanvasProps {
  state: CanvasState;
  dispatch: Dispatch<CanvasAction>;
  options: CanvasOptions;
  names: Names;
  errors: Map<string, string>;
  lit: Set<string>;
  /** Else edges the last test run passed through (their synthesised node matched). */
  litEdges?: Set<string>;
  /** Shown beside the palette while the rule is only its event node. */
  hint?: boolean;
}

const DRAG_TYPE = "application/x-boomerang-node";
const SNAP: [number, number] = [8, 8];
const FIT = { padding: 0.25, maxZoom: 1 };

function titleOf(kind: CanvasNodeKind, data: Record<string, unknown>, names: Names): string {
  switch (kind) {
    case "event":
      return eventSentence(data, names);
    case "condition":
      return conditionSentence(data, names);
    case "action":
      return actionSentence(data, names);
    case "schedule":
      return scheduleSentence(data);
  }
}

/** The focusable controls inside a node, in document order: Picker triggers, inputs, text areas. */
function controlsOf(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>('.picker-trigger, input, textarea, button:not([tabindex="-1"])')).filter((el) => !el.closest(".picker-popover") && !(el as HTMLInputElement).disabled);
}

/** Phones start at half zoom and pan: a whole rule fitted at the 0.3 floor is not readable. */
const isPhone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 720px)").matches;

function Flow({ state, dispatch, options, names, errors, lit, litEdges, hint }: RuleCanvasProps) {
  const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow();
  const rootRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  const phone = useMemo(isPhone, []);

  const nodes = useMemo<RuleNode[]>(
    () =>
      state.nodes.map((n) => ({
        id: n.id,
        type: n.kind,
        position: n.position,
        data: { values: n.data },
        selected: state.selectedNodes.includes(n.id),
        dragHandle: ".rnode-head",
        ariaLabel: `${KIND_LABEL[n.kind]} node: ${titleOf(n.kind, n.data, names)}`,
      })),
    [state.nodes, state.selectedNodes, names],
  );
  const edges = useMemo<Edge[]>(
    () =>
      state.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "smoothstep",
        label: e.label === "else" ? "else" : undefined,
        selected: state.selectedEdges.includes(e.id),
        className: [e.label === "else" ? "edge-else" : "", litEdges?.has(e.id) ? "is-lit" : ""].filter(Boolean).join(" ") || undefined,
      })),
    [state.edges, state.selectedEdges, litEdges],
  );

  const context = useMemo(
    () => ({ options, names, errors, lit, setData: (id: string, data: Record<string, unknown>) => dispatch({ type: "setData", id, data }) }),
    [options, names, errors, lit, dispatch],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => dispatch({ type: "nodesChange", changes }), [dispatch]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => dispatch({ type: "edgesChange", changes }), [dispatch]);
  const onConnect = useCallback((c: Connection) => dispatch({ type: "connect", source: c.source, target: c.target }), [dispatch]);

  // Timers this component sets (a deferred fit, a focus retry), cleared when it unmounts.
  const timers = useRef<number[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      timers.current = timers.current.filter((x) => x !== t);
      fn();
    }, ms);
    timers.current.push(t);
  }, []);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  // Two quick key presses can arrive before React re-renders, so placement reads the latest
  // drawing through a ref rather than the render's closure.
  const stateRef = useRef(state);
  stateRef.current = state;
  const addKind = useCallback(
    (kind: CanvasNodeKind, at?: { x: number; y: number }) => {
      const near = placeNear(stateRef.current);
      const node = buildNode(kind, at ?? near.position);
      const action: CanvasAction = { type: "addNode", node, from: at ? undefined : near.from, edgeId: newId("e") };
      stateRef.current = reducer(stateRef.current, action);
      dispatch(action);
      focusNext.current = node.id;
      // A node added from the keyboard may land outside the view; bring the drawing back in
      // (not on a phone, where the whole rule fitted would be too small to read).
      if (!at && !isPhone()) later(() => fitView({ ...FIT, duration: 150 }), 0);
    },
    [dispatch, fitView, later],
  );

  // A node added from the keyboard or the palette takes focus once it is on the canvas, so
  // Enter opens its first Picker and Tab carries on from it. React Flow draws a new node a
  // render after it arrives in props, so the lookup retries over a few frames.
  useEffect(() => {
    if (!focusNext.current) return;
    let tries = 0;
    const attempt = () => {
      const id = focusNext.current;
      if (!id) return;
      const el = rootRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
      if (el) {
        focusNext.current = null;
        el.focus();
      } else if (tries++ < 10) later(attempt, 16);
    };
    attempt();
  }, [state.nodes, later]);

  /**
   * The keyboard. Three places a key can land: the canvas surface (the wrapper or the pane), a
   * node element itself, or a control inside a node (a Picker, an input). Only the first two
   * take the canvas keys; a control keeps every key for itself, except Escape, which hands
   * focus back to its node once no Picker popover is open (the Picker closes its own popover
   * on Escape first, and lets the key bubble). Tab walks from a node into its controls in
   * order and out again to the next node, the same order the browser would use.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest(".picker-popover")) return;
    const node = target.closest<HTMLElement>(".react-flow__node");
    const onNode = !!node && target === node;
    const onSurface = target === rootRef.current || target.classList.contains("react-flow__pane") || target.classList.contains("react-flow");
    const inControl = !!node && !onNode;

    if (inControl) {
      if (e.key === "Escape" && !isPickerOpen()) {
        e.preventDefault();
        node.focus();
        return;
      }
      if (e.key === "Tab") {
        const controls = controlsOf(node);
        const i = controls.indexOf(target);
        if (i < 0) return;
        const next = e.shiftKey ? (i === 0 ? node : controls[i - 1]) : controls[i + 1];
        if (next) {
          e.preventDefault();
          next.focus();
        }
      }
      return;
    }
    if (!onNode && !onSurface) return;
    if (isTypingTarget()) return;

    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      dispatch({ type: e.shiftKey ? "redo" : "undo" });
      return;
    }
    if (mod || e.altKey) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      dispatch({ type: "removeSelection" });
      return;
    }
    if (onNode && e.key === "Enter") {
      const first = controlsOf(node)[0];
      if (first) {
        e.preventDefault();
        first.focus();
        if (first.classList.contains("picker-trigger")) first.click();
      }
      return;
    }
    if (onNode && e.key === "Tab" && !e.shiftKey) {
      const first = controlsOf(node)[0];
      if (first) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    const kind = (CANVAS_NODE_KINDS as readonly string[]).find((k) => KIND_KEY[k as CanvasNodeKind] === e.key) as CanvasNodeKind | undefined;
    if (!kind) return;
    e.preventDefault();
    if (kind === "event" || kind === "schedule") {
      // One start per rule: the key selects the one that exists rather than drawing a second.
      const start = stateRef.current.nodes.find((n) => n.kind === "event" || n.kind === "schedule");
      if (start) {
        dispatch({ type: "select", nodeIds: [start.id] });
        rootRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${start.id}"]`)?.focus();
        return;
      }
    }
    addKind(kind);
  }

  function onDrop(e: React.DragEvent) {
    const kind = e.dataTransfer.getData(DRAG_TYPE) as CanvasNodeKind;
    if (!(CANVAS_NODE_KINDS as readonly string[]).includes(kind)) return;
    e.preventDefault();
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addKind(kind, { x: Math.round(p.x / 8) * 8, y: Math.round(p.y / 8) * 8 });
  }

  const selectedEdge = state.selectedEdges.length === 1 ? state.edges.find((e) => e.id === state.selectedEdges[0]) : undefined;
  const edgeSource = selectedEdge ? state.nodes.find((n) => n.id === selectedEdge.source) : undefined;
  const onlyEvent = state.nodes.length === 1 && (state.nodes[0].kind === "event" || state.nodes[0].kind === "schedule");

  return (
    <CanvasContext.Provider value={context}>
      <div
        ref={rootRef}
        className="rule-canvas"
        tabIndex={0}
        role="application"
        aria-label="Rule canvas"
        aria-describedby="rule-canvas-help"
        onKeyDown={onKeyDown}
        onDrop={onDrop}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_TYPE)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }
        }}
      >
        <p id="rule-canvas-help" className="sr-only">
          Press e, c, a or s to add an event, condition, action or schedule node next to the selection. Delete removes it. Arrow keys nudge. Tab moves between nodes. Enter opens a node's first choice. Control or Command Z undoes.
        </p>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView={!phone}
          fitViewOptions={FIT}
          defaultViewport={phone ? { x: 16, y: 88, zoom: 0.5 } : undefined}
          snapToGrid
          snapGrid={SNAP}
          minZoom={0.3}
          maxZoom={2}
          panOnScroll
          zoomOnPinch
          deleteKeyCode={null}
          defaultEdgeOptions={{ type: "smoothstep" }}
          proOptions={{ hideAttribution: true }}
          nodesFocusable
          edgesFocusable
        >
          <Background variant={BackgroundVariant.Lines} gap={32} lineWidth={1} className="rule-grid" />
          <Panel position="top-right" className="rule-palette">
            <span className="rule-palette-title">Add</span>
            {CANVAS_NODE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`chip palette-chip palette-${KIND_FAMILY[kind]}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, kind);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => addKind(kind)}
                title={`Add a ${KIND_LABEL[kind].toLowerCase()} node (${KIND_KEY[kind]})`}
              >
                <kbd>{KIND_KEY[kind]}</kbd> {KIND_LABEL[kind]}
              </button>
            ))}
            {(hint ?? onlyEvent) && <p className="rule-palette-hint muted">Press c to add a condition, a to add an action</p>}
          </Panel>
          <Panel position="bottom-left" className="rule-controls">
            <button type="button" className="icon-btn" aria-label="Zoom in" title="Zoom in" onClick={() => zoomIn()}>
              <MagnifyingGlassPlus size={16} weight="regular" aria-hidden="true" />
            </button>
            <button type="button" className="icon-btn" aria-label="Zoom out" title="Zoom out" onClick={() => zoomOut()}>
              <MagnifyingGlassMinus size={16} weight="regular" aria-hidden="true" />
            </button>
            <button type="button" className="icon-btn" aria-label="Fit to view" title="Fit to view" onClick={() => fitView(FIT)}>
              <CornersOut size={16} weight="regular" aria-hidden="true" />
            </button>
            <span className="rule-controls-gap" aria-hidden="true" />
            <button type="button" className="icon-btn" aria-label="Undo" title="Undo" disabled={state.past.length === 0} onClick={() => dispatch({ type: "undo" })}>
              <ArrowUUpLeft size={16} weight="regular" aria-hidden="true" />
            </button>
            <button type="button" className="icon-btn" aria-label="Redo" title="Redo" disabled={state.future.length === 0} onClick={() => dispatch({ type: "redo" })}>
              <ArrowUUpRight size={16} weight="regular" aria-hidden="true" />
            </button>
          </Panel>
          {selectedEdge && edgeSource?.kind === "condition" && (
            <Panel position="bottom-center" className="rule-edge-panel">
              <Picker
                id="edge-branch"
                label="This edge runs when the condition"
                options={[
                  { id: "then", label: "Holds" },
                  { id: "else", label: "Does not hold (else)" },
                ]}
                value={selectedEdge.label === "else" ? "else" : "then"}
                onChange={(v) => dispatch({ type: "setEdgeLabel", id: selectedEdge.id, label: v === "else" ? "else" : undefined })}
              />
            </Panel>
          )}
        </ReactFlow>
      </div>
    </CanvasContext.Provider>
  );
}

export function RuleCanvas(props: RuleCanvasProps) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
