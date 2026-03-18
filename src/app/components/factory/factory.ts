import { Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import { CdkDrag, CdkDragEnd, CdkDragHandle, CdkDragMove } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { MatAnchor, MatButton } from "@angular/material/button";
import { MatIcon } from "@angular/material/icon";
import * as _ from 'lodash';

const NODE_W = 164;
const NODE_H = 96;
const INPUT_PORT_H = 16;
const CANVAS_PADDING = 120;

export interface FactoryNode {
  id: string;
  label: string;
  activeFormula: string | null;
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
  imports: [CdkDrag, CdkDragHandle, CdkScrollable, MatAnchor, MatButton, MatIcon],
  templateUrl: './factory.html',
  styleUrl: './factory.scss',
})
export class Factory {
  @ViewChild('canvasWorld') canvasWorldRef!: ElementRef<HTMLDivElement>;

  readonly NW = NODE_W;
  readonly NH = NODE_H;

  get canvasWidth(): number {
    if (this.nodes.length === 0) return 800;
    const maxX = Math.max(...this.nodes.map(n => this.visualPos(n).x + NODE_W));
    return maxX + CANVAS_PADDING;
  }

  get canvasHeight(): number {
    if (this.nodes.length === 0) return 600;
    const maxY = Math.max(...this.nodes.map(n => this.visualPos(n).y + NODE_H));
    return maxY + CANVAS_PADDING;
  }

  nodes: FactoryNode[] = [
    { id: 'n1', label: 'Ore extractor', activeFormula: 'Titanium Ore', x:  80, y: 240, freeDragPos: { x: 0, y: 0 }, nbInputs: 0 },
    { id: 'n2', label: 'Ore extractor', activeFormula: 'Wolfram Ore' , x: 100, y: 120, freeDragPos: { x: 0, y: 0 }, nbInputs: 0 },
    { id: 'n3', label: 'Smelter'      , activeFormula: 'Titanium bar', x: 150, y: 380, freeDragPos: { x: 0, y: 0 }, nbInputs: 1 },
    { id: 'n4', label: 'Smelter'      , activeFormula: 'Wolfram bar' , x: 200, y: 380, freeDragPos: { x: 0, y: 0 }, nbInputs: 1 },
    { id: 'n5', label: 'Fabricator'   , activeFormula: null, x: 380, y: 380, freeDragPos: { x: 0, y: 0 }, nbInputs: 2 },
    { id: 'n6', label: 'Fabricator'   , activeFormula: null, x: 680, y: 260, freeDragPos: { x: 0, y: 0 }, nbInputs: 2 },
    { id: 'n7', label: 'Furnace'      , activeFormula: null, x: 980, y: 260, freeDragPos: { x: 0, y: 0 }, nbInputs: 3 },
  ];

  connections: Connection[] = [
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
    // Read CDK's own transform for SVG path updates — do NOT feed this back to
    // [cdkDragFreeDragPosition] (that binding has been removed to avoid a
    // feedback loop where Angular CD re-applies the value CDK just computed).
    const p = ev.source.getFreeDragPosition();
    node.freeDragPos = { x: p.x, y: p.y };
  }

  onDragEnded(ev: CdkDragEnd, node: FactoryNode): void {
    const p = ev.source.getFreeDragPosition();
    // Absorb the CDK transform into the stored absolute position …
    node.x += p.x;
    node.y += p.y;
    // … then reset freeDragPos and let CDK reset its own internal transform.
    node.freeDragPos = { x: 0, y: 0 };
    ev.source.reset();
  }

  // ── SVG helpers ─────────────────────────────────────────────────────────────

  /** Cubic bezier from (x1,y1) to (x2,y2) with horizontal control-point handles. */
  private bezier(x1: number, y1: number, x2: number, y2: number): string {
    const dx = Math.max(Math.abs(x2 - x1) * 0.5, 80);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  private getIntputIdOffset(targetNode: FactoryNode, conn: Connection): number {
    const remaining = NODE_H - targetNode.nbInputs * INPUT_PORT_H;
    const spacing = remaining / (targetNode.nbInputs + 1);
    return spacing * (conn.toInputId + 1) + INPUT_PORT_H * conn.toInputId + INPUT_PORT_H / 2;
  }

  /** SVG path for an established connection (right-centre → left-centre). */
  arrowPath(conn: Connection): string {
    const f = this.nodes.find(n => n.id === conn.fromId);
    const t = this.nodes.find(n => n.id === conn.toId);
    if (!f || !t) return '';
    const fp = this.visualPos(f);
    const tp = this.visualPos(t);
    const inputIdOffset = this.getIntputIdOffset(t, conn);
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
    const inputIdOffset = this.getIntputIdOffset(t, conn);
    return {
      x: (fp.x + NODE_W + tp.x) / 2,
      y: (fp.y + NODE_H / 2 + tp.y + inputIdOffset) / 2,
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
        activeFormula: null,
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
