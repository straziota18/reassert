import { Component, computed, ElementRef, HostListener, Signal, signal, ViewChild } from '@angular/core';
import { CdkDrag, CdkDragEnd, CdkDragHandle, CdkDragMove } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { MatAnchor, MatButton } from "@angular/material/button";
import { MatIcon } from "@angular/material/icon";
import * as _ from 'lodash';
import { MatDialog } from '@angular/material/dialog';
import { ItemSelectDialog, ItemSelectDialogData } from '../item-select-dialog/item-select-dialog';
import { FactoryCanvasNode, Connection, getNbInputs, getNbOutputs, getNodeLabel, isMissingFormula, isActiveFactory, getActiveFormulaSignal } from '../../services/model';

const NODE_W = 164;
const NODE_H = 96;
const PORT_H = 16;
const CANVAS_PADDING = 120;

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

  readonly getNodeLabel = getNodeLabel;
  readonly isMissingFormula = isMissingFormula;
  readonly isActiveFactory = isActiveFactory;
  readonly activeFormulaSignals: {[id: string]: Signal<string>} = {};

  constructor(private readonly matDialog: MatDialog) { }

  // ── Node state ──────────────────────────────────────────────────────────────

  // TODO extract this data from a service
  readonly nodes = signal<FactoryCanvasNode[]>([]);

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
    return _.range(0, getNbInputs(node));
  }

  outputIds(node: FactoryCanvasNode): number[] {
    return _.range(0, getNbOutputs(node));
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
      inputOffset: this.getOffset(getNbInputs(targetNode), conn.toInputId),
      outputOffset: this.getOffset(getNbOutputs(srcNode), conn.fromOutputId),
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
    const offset = this.getOffset(getNbOutputs(this.pendingFrom.node), this.pendingFrom.outputId);
    return this.bezier(fp.x + NODE_W, fp.y + offset, this.pendingMouse.x, this.pendingMouse.y);
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
    this.pendingFrom = { node, outputId };
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
      // TODO fix with actual service
      // const id = `n${this.nodes().length + 1}`; // pick a unique id
      // const newNode: FactoryCanvasNode = {
      //   id,
      //   label: selected,
      //   activeFormula: null,
      //   x: 120 + Math.random() * 600,
      //   y: 80 + Math.random() * 600,
      //   freeDragPos: { x: 0, y: 0 },
      // };
      // this.nodes.update(ns => [...ns, newNode]);
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
    return getNbInputs(node) === 0 ? 'Raw material' : `${nbInputs}/${getNbInputs(node)} inputs available`;
  }

  startFormulaChange(node: FactoryCanvasNode) {
    // TODO open dialog, select possible resource, etc
  }
}
