import { Component, computed, ElementRef, HostListener, signal, ViewChild } from '@angular/core';
import { CdkDrag, CdkDragEnd, CdkDragHandle, CdkDragMove } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { MatAnchor, MatButton } from "@angular/material/button";
import { MatIcon } from "@angular/material/icon";
import * as _ from 'lodash';
import { MatDialog } from '@angular/material/dialog';
import { ItemSelectDialog, ItemSelectDialogData } from '../item-select-dialog/item-select-dialog';

const NODE_W = 164;
const NODE_H = 96;
const PORT_H = 16;
const CANVAS_PADDING = 120;

export interface FactoryCanvasNode {
  id: string;
  label: string;
  activeFormula: string | null;
  x: number;
  y: number;
  /** Always {0,0} at rest; accumulates CDK transform during a drag, then absorbed into x/y on drop. */
  freeDragPos: { x: number; y: number };
  nbInputs: number;
  nbOutputs: number;
}

export interface Connection {
  id: string;
  fromId: string;
  fromOutputId: number;
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

  constructor(private readonly matDialog: MatDialog) { }

  // ── Node state ──────────────────────────────────────────────────────────────

  // TODO extract this data from a service
  readonly nodes = signal<FactoryCanvasNode[]>([
    { id: 'n1', label: 'Ore extractor', activeFormula: 'Titanium Ore', x: 80, y: 240, freeDragPos: { x: 0, y: 0 }, nbInputs: 0, nbOutputs: 1 },
    { id: 'n2', label: 'Ore extractor', activeFormula: 'Wolfram Ore', x: 100, y: 120, freeDragPos: { x: 0, y: 0 }, nbInputs: 0, nbOutputs: 1 },
    { id: 'n3', label: 'Smelter', activeFormula: 'Titanium bar', x: 150, y: 380, freeDragPos: { x: 0, y: 0 }, nbInputs: 1, nbOutputs: 1 },
    { id: 'n4', label: 'Smelter', activeFormula: 'Wolfram bar', x: 200, y: 380, freeDragPos: { x: 0, y: 0 }, nbInputs: 1, nbOutputs: 1 },
    { id: 'n5', label: 'Fabricator', activeFormula: null, x: 380, y: 380, freeDragPos: { x: 0, y: 0 }, nbInputs: 2, nbOutputs: 1 },
    { id: 'n6', label: 'Fabricator', activeFormula: null, x: 680, y: 260, freeDragPos: { x: 0, y: 0 }, nbInputs: 2, nbOutputs: 1 },
    { id: 'n7', label: 'Furnace', activeFormula: null, x: 980, y: 260, freeDragPos: { x: 0, y: 0 }, nbInputs: 3, nbOutputs: 1 },
    { id: 'n8', label: 'Virtual source', activeFormula: null, x: 500, y: 660, freeDragPos: { x: 0, y: 0 }, nbInputs: 0, nbOutputs: 4 },
  ]);

  /**
   * Canvas width derived from the rightmost node edge + padding.
   * Re-evaluates only when `nodes` signal changes (add / delete / drag).
   */
  readonly canvasWidth = computed(() => {
    const ns = this.nodes();
    if (ns.length === 0) return 800;
    const maxX = Math.max(...ns.map(n => this.visualPos(n).x + NODE_W));
    return maxX + CANVAS_PADDING;
  });

  /**
   * Canvas height derived from the bottom-most node edge + padding.
   * Re-evaluates only when `nodes` signal changes.
   */
  readonly canvasHeight = computed(() => {
    const ns = this.nodes();
    if (ns.length === 0) return 600;
    const maxY = Math.max(...ns.map(n => this.visualPos(n).y + NODE_H));
    return maxY + CANVAS_PADDING;
  });

  // ── Connections ─────────────────────────────────────────────────────────────

  connections: Connection[] = [];

  /** Node whose output port was clicked — awaiting a target input port click. */
  pendingFrom: {
    node: FactoryCanvasNode,
    outputId: number
   } | null = null;
  /** Current mouse position on the canvas-world, used to draw the in-progress arrow. */
  pendingMouse = { x: 0, y: 0 };

  inputIds(node: FactoryCanvasNode): number[] {
    return _.range(0, node.nbInputs);
  }

  outputIds(node: FactoryCanvasNode): number[] {
    return _.range(0, node.nbOutputs);
  }

  // ── Keyboard ────────────────────────────────────────────────────────────────

  @HostListener('document:keydown.escape')
  onEscape() {
    this.pendingFrom = null;
  }

  // ── Drag ────────────────────────────────────────────────────────────────────

  /** Visual top-left of the node, accounting for any in-flight CDK transform. */
  visualPos(node: FactoryCanvasNode): { x: number; y: number } {
    return { x: node.x + node.freeDragPos.x, y: node.y + node.freeDragPos.y };
  }

  onDragMoved(ev: CdkDragMove, node: FactoryCanvasNode): void {
    // Read CDK's own transform for SVG path updates — do NOT feed this back to
    // [cdkDragFreeDragPosition] (that binding has been removed to avoid a
    // feedback loop where Angular CD re-applies the value CDK just computed).
    const p = ev.source.getFreeDragPosition();
    node.freeDragPos = { x: p.x, y: p.y };
    // Spread the array so canvasWidth / canvasHeight computed signals re-evaluate
    // and the SVG arrows track the moving node.
    this.nodes.update(ns => [...ns]);
  }

  onDragEnded(ev: CdkDragEnd, node: FactoryCanvasNode): void {
    const p = ev.source.getFreeDragPosition();
    // Absorb the CDK transform into the stored absolute position …
    node.x += p.x;
    node.y += p.y;
    // … then reset freeDragPos and let CDK reset its own internal transform.
    node.freeDragPos = { x: 0, y: 0 };
    ev.source.reset();
    this.nodes.update(ns => [...ns]);
  }

  // ── SVG helpers ─────────────────────────────────────────────────────────────

  /** Cubic bezier from (x1,y1) to (x2,y2) with horizontal control-point handles. */
  private bezier(x1: number, y1: number, x2: number, y2: number): string {
    const dx = Math.max(Math.abs(x2 - x1) * 0.5, 80);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  private getOffset(nbPorts: number, portId: number): number {
    const remaining = NODE_H - nbPorts * PORT_H;
    const spacing = remaining / (nbPorts + 1);
    return spacing * (portId + 1) + PORT_H * portId + PORT_H / 2;
  }

  private getOffsets(srcNode: FactoryCanvasNode, targetNode: FactoryCanvasNode, conn: Connection): { inputOffset: number, outputOffset: number } {
    return {
      inputOffset: this.getOffset(targetNode.nbInputs, conn.toInputId),
      outputOffset: this.getOffset(srcNode.nbOutputs, conn.fromOutputId),
    };
  }

  /** SVG path for an established connection (right-centre → left-centre). */
  arrowPath(conn: Connection): string {
    const f = this.nodes().find(n => n.id === conn.fromId);
    const t = this.nodes().find(n => n.id === conn.toId);
    if (!f || !t) return '';
    const fp = this.visualPos(f);
    const tp = this.visualPos(t);
    const offset = this.getOffsets(f, t, conn);
    return this.bezier(fp.x + NODE_W, fp.y + offset.outputOffset, tp.x, tp.y + offset.inputOffset);
  }

  /** SVG path for the in-progress arrow while the user is picking a target. */
  pendingPath(): string {
    if (!this.pendingFrom) return '';
    const fp = this.visualPos(this.pendingFrom.node);
    const offset = this.getOffset(this.pendingFrom.node.nbOutputs, this.pendingFrom.outputId);
    return this.bezier(fp.x + NODE_W, fp.y + NODE_H / 2, this.pendingMouse.x, this.pendingMouse.y);
  }

  /** Approximate midpoint of a connection's bezier (used for the delete handle). */
  arrowMid(conn: Connection): { x: number; y: number } | null {
    const f = this.nodes().find(n => n.id === conn.fromId);
    const t = this.nodes().find(n => n.id === conn.toId);
    if (!f || !t) return null;
    const fp = this.visualPos(f);
    const tp = this.visualPos(t);
    const offset = this.getOffsets(f, t, conn);
    return {
      x: (fp.x + NODE_W + tp.x) / 2,
      y: (fp.y + offset.outputOffset + tp.y + offset.inputOffset) / 2,
    };
  }

  // ── Connection management ───────────────────────────────────────────────────

  /** Click on a node's output port: begin drawing a new arrow from this node.
   *  Removes any pre-existing outgoing connection (only 1 is allowed). */
  startConn(node: FactoryCanvasNode, outputId: number, ev: MouseEvent): void {
    ev.stopPropagation();
    // remove connections starting at output
    this.connections = this.connections.filter(c => !(c.fromId === node.id && c.fromOutputId === outputId));
    this.pendingFrom = {node, outputId};
    // Pre-position the pending arrow tip so it doesn't jump on first render
    const fp = this.visualPos(node);
    this.pendingMouse = { x: fp.x + NODE_W + 4, y: fp.y + NODE_H / 2 };
  }

  /** Click on a node's input port: complete the pending arrow. */
  finishConn(node: FactoryCanvasNode, inputId: number, ev: MouseEvent): void {
    ev.stopPropagation();
    if (!this.pendingFrom) return;
    if (this.pendingFrom.node.id === node.id) {
      // Clicked own input — cancel
      this.pendingFrom = null;
      return;
    }
    // remove connections arriving at input port
    this.connections = this.connections.filter(c => !(c.toId === node.id && c.toInputId === inputId));
    this.connections = [
      ...this.connections,
      { id: `c${Date.now()}`, fromId: this.pendingFrom.node.id, toId: node.id, toInputId: inputId, fromOutputId: this.pendingFrom.outputId },
    ];
    this.pendingFrom = null;
  }

  deleteConn(id: string, ev: MouseEvent): void {
    ev.stopPropagation();
    this.connections = this.connections.filter(c => c.id !== id);
  }

  hasOutgoing(nodeId: string, outputId: number): boolean {
    return this.connections.some(c => c.fromId === nodeId && c.fromOutputId === outputId);
  }

  // ── Mouse tracking ──────────────────────────────────────────────────────────

  onMouseMove(ev: MouseEvent): void {
    if (!this.pendingFrom) return;
    const rect = this.canvasWorldRef.nativeElement.getBoundingClientRect();
    this.pendingMouse = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  // ── Node CRUD ───────────────────────────────────────────────────────────────

  addNode(): void {
    const ref = this.matDialog.open<ItemSelectDialog, ItemSelectDialogData, string>(
      ItemSelectDialog,
      {
        data: {
          title: 'Select a factory',
          items: ['Ore extractor', 'Smelter', 'Fabricator', 'Furnace'],  // TODO get list of factories
        },
        width: '420px',
        maxWidth: '95vw',
      }
    );

    ref.afterClosed().subscribe(selected => {
      if (!selected) return;
      const id = `n${this.nodes().length + 1}`;
      const newNode: FactoryCanvasNode = {
        id,
        label: selected,
        activeFormula: null,
        x: 120 + Math.random() * 600,
        y: 80 + Math.random() * 600,
        freeDragPos: { x: 0, y: 0 },
        nbInputs: 1,  // TODO check inputs,
        nbOutputs: 1 // TODO check outputs
      };
      this.nodes.update(ns => [...ns, newNode]);
    });
  }

  deleteNode(node: FactoryCanvasNode, ev: MouseEvent): void {
    ev.stopPropagation();
    this.nodes.update(ns => ns.filter(n => n.id !== node.id));
    this.connections = this.connections.filter(
      c => c.fromId !== node.id && c.toId !== node.id,
    );
    if (this.pendingFrom?.node.id === node.id) this.pendingFrom = null;
  }

  trackById = (_: number, item: { id: string }) => item.id;

  getInputStatusCss(node: FactoryCanvasNode): string | null {
    // TODO, check if missing input or inefficient
    return null;
  }

  getInputStatus(node: FactoryCanvasNode): string {
    // TODO, similar to getInputStatusCss - logic is more complex
    const nbInputs = this.connections.filter(
      c => c.toId === node.id,
    ).length;
    return node.nbInputs === 0 ? 'Raw material' : `${nbInputs}/${node.nbInputs} inputs available`;
  }
}
