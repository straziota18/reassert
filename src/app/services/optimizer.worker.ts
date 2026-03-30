/// <reference lib="webworker" />
import { WorkerRequest, WorkerResponse } from './optimizer.worker.types';
import { SerializedFactoryLayout } from './object-store-service';

/** Must match the values in factory.ts */
const NODE_W = 208;
const NODE_H = 96;
/** Horizontal gap between successive columns. */
const H_GAP = 80;
/** Minimum vertical gap between nodes in the same column. */
const V_GAP = 40;
/** Minimum canvas margin around the entire layout. */
const CANVAS_PADDING = 120;
/** Number of forward+backward barycenter sweeps for crossing minimisation. */
const SWEEP_PASSES = 4;
/**
 * Number of forward+backward relaxation passes for vertical coordinate
 * assignment.  Each pass nudges nodes toward their neighbours' Y positions.
 */
const RELAX_ITERS = 12;
/** How aggressively each node moves toward its ideal Y on every pass (0–1). */
const RELAX_ALPHA = 0.5;
/** Minimum pixel distance between the top edges of two nodes in the same column. */
const MIN_SPACING = NODE_H + V_GAP; // 136 px

addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  const result = optimizeLayout(data.payload);
  const response: WorkerResponse = { status: 'success', actionId: data.actionId, result };
  postMessage(response);
});

// ─────────────────────────────────────────────────────────────────────────────
// Top-level orchestrator
// ─────────────────────────────────────────────────────────────────────────────

function optimizeLayout(layout: SerializedFactoryLayout): SerializedFactoryLayout {
  const nodes = layout.factories;
  const connections = layout.connections;

  if (nodes.length === 0) return layout;

  const nodeIds = nodes.map(n => n.id);

  // ── 1. Build directed adjacency sets ───────────────────────────────────────
  const outEdges = new Map<string, Set<string>>();
  const inEdges  = new Map<string, Set<string>>();

  for (const id of nodeIds) {
    outEdges.set(id, new Set());
    inEdges.set(id,  new Set());
  }

  for (const conn of connections) {
    if (outEdges.has(conn.fromId) && inEdges.has(conn.toId)) {
      outEdges.get(conn.fromId)!.add(conn.toId);
      inEdges.get(conn.toId)!.add(conn.fromId);
    }
  }

  // ── 2. Build undirected neighbour map (used for Y-relaxation) ──────────────
  const allNeighbors = new Map<string, Set<string>>();
  for (const id of nodeIds) {
    allNeighbors.set(id, new Set([
      ...Array.from(outEdges.get(id)!),
      ...Array.from(inEdges.get(id)!),
    ]));
  }

  // ── 3. Assign each node a column (layer) via longest-path layering ──────────
  const columnOf = assignLayers(nodeIds, outEdges, inEdges);

  // ── 4. Group nodes by column ────────────────────────────────────────────────
  const columns = new Map<number, string[]>();
  for (const [id, col] of columnOf) {
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(id);
  }

  const sortedCols = Array.from(columns.keys()).sort((a, b) => a - b);

  // ── 5. Minimise crossings (barycenter heuristic, multiple sweeps) ───────────
  // `rowOf` tracks each node's ordinal position within its column.
  const rowOf = new Map<string, number>();
  for (const col of sortedCols) {
    columns.get(col)!.forEach((id, i) => rowOf.set(id, i));
  }

  for (let pass = 0; pass < SWEEP_PASSES; pass++) {
    // Forward sweep: sort column[i] by barycenter of their predecessors
    for (let ci = 1; ci < sortedCols.length; ci++) {
      sortColumn(columns.get(sortedCols[ci])!, inEdges, rowOf);
    }
    // Backward sweep: sort column[i] by barycenter of their successors
    for (let ci = sortedCols.length - 2; ci >= 0; ci--) {
      sortColumn(columns.get(sortedCols[ci])!, outEdges, rowOf);
    }
  }

  // ── 6. Assign x-coordinates (fixed by column) ──────────────────────────────
  const xOf = new Map<string, number>();
  for (const col of sortedCols) {
    const x = CANVAS_PADDING + col * (NODE_W + H_GAP);
    for (const id of columns.get(col)!) xOf.set(id, x);
  }

  // ── 7. Assign initial y-coordinates (evenly spaced, no centering) ──────────
  // Centering is deliberately avoided here: we want nodes to float freely
  // toward their actual neighbours in the relaxation phase below.
  const yOf = new Map<string, number>();
  for (const col of sortedCols) {
    const ids = columns.get(col)!;
    for (let i = 0; i < ids.length; i++) {
      yOf.set(ids[i], CANVAS_PADDING + i * MIN_SPACING);
    }
  }

  // ── 8. Iterative Y-relaxation ───────────────────────────────────────────────
  // Each pass nudges every node toward the mean Y of its cross-column
  // neighbours, then enforces the minimum column spacing via a
  // forward+backward scan.  Alternating forward/backward column traversal
  // propagates alignment cues across the full width of the graph.
  for (let iter = 0; iter < RELAX_ITERS; iter++) {
    for (const col of sortedCols) {
      const ids = columns.get(col)!;
      relaxColumn(ids, new Set(ids), yOf, allNeighbors);
    }
    for (const col of [...sortedCols].reverse()) {
      const ids = columns.get(col)!;
      relaxColumn(ids, new Set(ids), yOf, allNeighbors);
    }
  }

  // ── 9. Translate so the topmost node sits at CANVAS_PADDING ────────────────
  const minY  = Math.min(...Array.from(yOf.values()));
  const shift = CANVAS_PADDING - minY;
  if (Math.abs(shift) > 0.5) {
    for (const id of nodeIds) yOf.set(id, yOf.get(id)! + shift);
  }

  // ── 10. Rebuild the serialised layout with updated positions ────────────────
  return {
    ...layout,
    factories: nodes.map(node => {
      const x = xOf.get(node.id);
      const y = yOf.get(node.id);
      if (x === undefined || y === undefined) return node;
      return { ...node, x: Math.round(x), y: Math.round(y), freeDragPos: { x: 0, y: 0 } };
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer assignment (longest-path from sources → column index)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assigns a column index to every node using longest-path layering:
 * - source nodes (no incoming edges) → column 0
 * - every other node → max(predecessor columns) + 1
 *
 * Nodes that are part of cycles are handled gracefully by appending them after
 * the acyclic portion of the graph.
 */
function assignLayers(
  nodeIds: string[],
  outEdges: Map<string, Set<string>>,
  inEdges:  Map<string, Set<string>>,
): Map<string, number> {
  // Kahn's algorithm for topological sort
  const inDegree  = new Map<string, number>(nodeIds.map(id => [id, inEdges.get(id)!.size]));
  const topoOrder: string[] = [];
  const queue = nodeIds.filter(id => inDegree.get(id) === 0);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    topoOrder.push(cur);
    for (const next of outEdges.get(cur) ?? []) {
      const deg = inDegree.get(next)! - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  // Nodes involved in cycles won't appear in topoOrder — append them at the end
  const inTopo = new Set(topoOrder);
  for (const id of nodeIds) {
    if (!inTopo.has(id)) topoOrder.push(id);
  }

  // Longest-path column assignment in topological order
  const columnOf = new Map<string, number>();
  for (const id of topoOrder) {
    const preds = Array.from(inEdges.get(id) ?? []);
    const col = preds.length > 0
      ? Math.max(...preds.map(p => columnOf.get(p) ?? 0)) + 1
      : 0;
    columnOf.set(id, col);
  }

  return columnOf;
}

// ─────────────────────────────────────────────────────────────────────────────
// Barycenter helpers (crossing minimisation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sorts the given list of node IDs in-place by barycenter relative to their
 * neighbours (via `edges`) in the current `rowOf` mapping.  Nodes whose
 * neighbours are not found in `rowOf` preserve their relative order.
 * After sorting, `rowOf` is updated to reflect the new positions.
 */
function sortColumn(
  ids: string[],
  edges: Map<string, Set<string>>,
  rowOf: Map<string, number>,
): void {
  ids.sort((a, b) => {
    const aBar = barycenter(a, edges, rowOf);
    const bBar = barycenter(b, edges, rowOf);
    const aScore = aBar ?? rowOf.get(a)!;
    const bScore = bBar ?? rowOf.get(b)!;
    return aScore - bScore;
  });
  ids.forEach((id, i) => rowOf.set(id, i));
}

/**
 * Returns the average row index of a node's neighbours (via `edges`), or
 * `null` when no neighbours are present in the `rowOf` map.
 */
function barycenter(
  nodeId: string,
  edges:  Map<string, Set<string>>,
  rowOf:  Map<string, number>,
): number | null {
  const positions: number[] = [];
  for (const neighbour of edges.get(nodeId) ?? []) {
    const row = rowOf.get(neighbour);
    if (row !== undefined) positions.push(row);
  }
  if (positions.length === 0) return null;
  return positions.reduce((s, p) => s + p, 0) / positions.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Y-relaxation helpers (vertical coordinate refinement)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One relaxation pass for a single column:
 *
 * 1. Each node moves `RELAX_ALPHA` of the way toward the mean Y of its
 *    cross-column neighbours (nodes in the same column are ignored so we only
 *    respond to actual graph connections).  Nodes with no cross-column
 *    neighbours keep their current Y.
 *
 * 2. A forward scan (top → bottom) pushes nodes down to maintain MIN_SPACING.
 *
 * 3. A backward scan (bottom → top) pushes nodes up to maintain MIN_SPACING,
 *    preventing the group from drifting indefinitely downward.
 *
 * The order of nodes within the column is never changed here; only their Y
 * values are adjusted.
 */
function relaxColumn(
  ids: string[],
  colSet: Set<string>,
  yOf: Map<string, number>,
  allNeighbors: Map<string, Set<string>>,
): void {
  if (ids.length === 0) return;

  // Step 1 – nudge toward cross-column neighbours
  for (const id of ids) {
    const crossYs: number[] = [];
    for (const n of allNeighbors.get(id) ?? []) {
      if (!colSet.has(n)) {
        const y = yOf.get(n);
        if (y !== undefined) crossYs.push(y);
      }
    }
    if (crossYs.length === 0) continue; // no preference — stay put

    const idealY = crossYs.reduce((s, v) => s + v, 0) / crossYs.length;
    const cur    = yOf.get(id)!;
    yOf.set(id, cur + RELAX_ALPHA * (idealY - cur));
  }

  // Step 2 – forward scan: push down if too close to node above
  for (let i = 1; i < ids.length; i++) {
    const minY = yOf.get(ids[i - 1])! + MIN_SPACING;
    if (yOf.get(ids[i])! < minY) yOf.set(ids[i], minY);
  }

  // Step 3 – backward scan: push up if too close to node below
  for (let i = ids.length - 2; i >= 0; i--) {
    const maxY = yOf.get(ids[i + 1])! - MIN_SPACING;
    if (yOf.get(ids[i])! > maxY) yOf.set(ids[i], maxY);
  }
}
