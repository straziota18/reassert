import { Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import { CdkDrag, CdkDragEnd, CdkDragHandle, CdkDragMove } from '@angular/cdk/drag-drop';
import { MatAnchor, MatButton } from "@angular/material/button";
import { MatIcon } from "@angular/material/icon";
import * as _ from 'lodash';

const NODE_W = 164;
const NODE_H = 96;
const CANVAS_W = 2400;
const CANVAS_H = 1600;

export interface FactoryNode {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Always {0,0} at rest; accumulates CDK transform during a drag, then absorbed into x/y on drop. */
  freeDragPos: { x: number; y: number };
  nbInputs: number;
}

export interface Connection {
  id: string;
  fromId: string;
  toId: string;
  toInputId: number;
}

@Component({
  selector: 'app-factory',
  imports: [CdkDrag, CdkDragHandle, MatAnchor, MatButton, MatIcon],
  templateUrl: './factory.html',
  styleUrl: './factory.scss',
})
export class Factory {
  @ViewChild('canvasWorld') canvasWorldRef!: ElementRef<HTMLDivElement>;

  readonly NW = NODE_W;
  readonly NH = NODE_H;
  readonly CW = CANVAS_W;
  readonly CH = CANVAS_H;

  nodes: FactoryNode[] = [
    { id: 'n1', label: 'Input',     x:  80, y: 240, freeDragPos: { x: 0, y: 0 }, nbInputs: 1 },
    { id: 'n2', label: 'Process A', x: 380, y: 120, freeDragPos: { x: 0, y: 0 }, nbInputs: 2 },
    { id: 'n3', label: 'Process B', x: 380, y: 380, freeDragPos: { x: 0, y: 0 }, nbInputs: 3 },
    { id: 'n4', label: 'Merge',     x: 680, y: 260, freeDragPos: { x: 0, y: 0 }, nbInputs: 2 },
    { id: 'n5', label: 'Output',    x: 980, y: 260, freeDragPos: { x: 0, y: 0 }, nbInputs: 4 },
  ];

  connections: Connection[] = [
    { id: 'c1', fromId: 'n1', toId: 'n2', toInputId: 0 },
    { id: 'c2', fromId: 'n3', toId: 'n4', toInputId: 0 },
    { id: 'c3', fromId: 'n2', toId: 'n4', toInputId: 0 },
    { id: 'c4', fromId: 'n4', toId: 'n5', toInputId: 0 },
  ];

  /** Node whose output port was clicked — awaiting a target input port click. */
  pendingFrom: FactoryNode | null = null;
  /** Current mouse position on the canvas-world, used to draw the in-progress arrow. */
  pendingMouse = { x: 0, y: 0 };

  private idCounter = 6;

  inputIds(node: FactoryNode): number[] {
    return _.range(0, node.nbInputs);
  }

  // ── Keyboard ────────────────────────────────────────────────────────────────

  @HostListener('document:keydown.escape')
  onEscape() {
    this.pendingFrom = null;
  }

  // ── Drag ────────────────────────────────────────────────────────────────────

  /** Visual top-left of the node, accounting for any in-flight CDK transform. */
  visualPos(node: FactoryNode): { x: number; y: number } {
    return { x: node.x + node.freeDragPos.x, y: node.y + node.freeDragPos.y };
  }

  onDragMoved(ev: CdkDragMove, node: FactoryNode): void {
    const p = ev.source.getFreeDragPosition();
    // Mutate the object reference so the SVG paths update via change detection
    node.freeDragPos = { x: p.x, y: p.y };
  }

  onDragEnded(ev: CdkDragEnd, node: FactoryNode): void {
    const p = ev.source.getFreeDragPosition();
    // Absorb the delta into the stored absolute position …
    node.x += p.x;
    node.y += p.y;
    // … then reset freeDragPos so the next drag starts fresh from the CSS left/top.
    node.freeDragPos = { x: 0, y: 0 };
  }

  // ── SVG helpers ─────────────────────────────────────────────────────────────

  /** Cubic bezier from (x1,y1) to (x2,y2) with horizontal control-point handles. */
  private bezier(x1: number, y1: number, x2: number, y2: number): string {
    const dx = Math.max(Math.abs(x2 - x1) * 0.5, 80);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  /** SVG path for an established connection (right-centre → left-centre). */
  arrowPath(conn: Connection): string {
    const f = this.nodes.find(n => n.id === conn.fromId);
    const t = this.nodes.find(n => n.id === conn.toId);
    if (!f || !t) return '';
    const fp = this.visualPos(f);
    const tp = this.visualPos(t);
    const fakeNbInputs = t.nbInputs + 2; // space-evenly add 2 fake points at begin/end.... or so it seems
    const inputIdOffset = t.nbInputs === 1 ? NODE_H / 2 : (conn.toInputId + 1) * NODE_H / (fakeNbInputs - 1);
    return this.bezier(fp.x + NODE_W, fp.y + NODE_H / 2, tp.x, tp.y + inputIdOffset);
  }

  /** SVG path for the in-progress arrow while the user is picking a target. */
  pendingPath(): string {
    if (!this.pendingFrom) return '';
    const fp = this.visualPos(this.pendingFrom);
    return this.bezier(fp.x + NODE_W, fp.y + NODE_H / 2, this.pendingMouse.x, this.pendingMouse.y);
  }

  /** Approximate midpoint of a connection's bezier (used for the delete handle). */
  arrowMid(conn: Connection): { x: number; y: number } | null {
    const f = this.nodes.find(n => n.id === conn.fromId);
    const t = this.nodes.find(n => n.id === conn.toId);
    if (!f || !t) return null;
    const fp = this.visualPos(f);
    const tp = this.visualPos(t);
    return {
      x: (fp.x + NODE_W + tp.x) / 2,
      y: (fp.y + NODE_H / 2 + tp.y + NODE_H / 2) / 2,
    };
  }

  // ── Connection management ───────────────────────────────────────────────────

  /** Click on a node's output port: begin drawing a new arrow from this node.
   *  Removes any pre-existing outgoing connection (only 1 is allowed). */
  startConn(node: FactoryNode, ev: MouseEvent): void {
    ev.stopPropagation();
    this.connections = this.connections.filter(c => c.fromId !== node.id);
    this.pendingFrom = node;
    // Pre-position the pending arrow tip so it doesn't jump on first render
    const fp = this.visualPos(node);
    this.pendingMouse = { x: fp.x + NODE_W + 4, y: fp.y + NODE_H / 2 };
  }

  /** Click on a node's input port: complete the pending arrow. */
  finishConn(node: FactoryNode, inputId: number, ev: MouseEvent): void {
    ev.stopPropagation();
    if (!this.pendingFrom) return;
    if (this.pendingFrom.id === node.id) {
      // Clicked own input — cancel
      this.pendingFrom = null;
      return;
    }
    this.connections = [
      ...this.connections,
      { id: `c${Date.now()}`, fromId: this.pendingFrom.id, toId: node.id, toInputId: inputId },
    ];
    this.pendingFrom = null;
  }

  deleteConn(id: string, ev: MouseEvent): void {
    ev.stopPropagation();
    this.connections = this.connections.filter(c => c.id !== id);
  }

  hasOutgoing(nodeId: string): boolean {
    return this.connections.some(c => c.fromId === nodeId);
  }

  // ── Mouse tracking ──────────────────────────────────────────────────────────

  onMouseMove(ev: MouseEvent): void {
    if (!this.pendingFrom) return;
    const rect = this.canvasWorldRef.nativeElement.getBoundingClientRect();
    this.pendingMouse = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  // ── Node CRUD ───────────────────────────────────────────────────────────────

  addNode(): void {
    const id = `n${this.idCounter++}`;
    this.nodes = [
      ...this.nodes,
      {
        id,
        label: `Node ${id}`,
        x: 120 + Math.random() * 600,
        y: 80  + Math.random() * 600,
        freeDragPos: { x: 0, y: 0 },
        nbInputs: 1
      },
    ];
  }

  deleteNode(node: FactoryNode, ev: MouseEvent): void {
    ev.stopPropagation();
    this.nodes = this.nodes.filter(n => n.id !== node.id);
    this.connections = this.connections.filter(
      c => c.fromId !== node.id && c.toId !== node.id,
    );
    if (this.pendingFrom?.id === node.id) this.pendingFrom = null;
  }

  trackById = (_: number, item: { id: string }) => item.id;
}
