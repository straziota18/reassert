import { AfterViewInit, Component, computed, ElementRef, HostListener, inject, signal, ViewChild } from '@angular/core';
import { CdkDrag, CdkDragEnd, CdkDragHandle, CdkDragMove } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { MatAnchor, MatButton } from "@angular/material/button";
import { MatIcon } from "@angular/material/icon";
import * as _ from 'lodash';
import { MatDialog } from '@angular/material/dialog';
import { ItemSelectDialog, ItemSelectDialogData, ItemSelectDialogResult } from '../item-select-dialog/item-select-dialog';
import { FactoryCanvasNode, Connection, getNbInputs, getNbOutputs, getNodeLabel, isMissingFormula, isActiveFactory, ActiveFactory } from '../../services/model';
import { UserSessionService } from '../../services/user-session-service';
import { OptimizationService } from '../../services/optimization-service';
import { ObjectStoreService } from '../../services/object-store-service';

const NODE_W = 208;
const NODE_H = 96;
const PORT_H = 16;
const CANVAS_PADDING = 120;

@Component({
  selector: 'app-factory',
  imports: [CdkDrag, CdkDragHandle, CdkScrollable, MatAnchor, MatButton, MatIcon],
  templateUrl: './factory.html',
  styleUrl: './factory.scss',
})
export class Factory implements AfterViewInit {
  @ViewChild('canvasWorld') canvasWorldRef!: ElementRef<HTMLDivElement>;
  @ViewChild('canvasContainer') canvasContainerRef!: ElementRef<HTMLDivElement>;

  private readonly userSessionService: UserSessionService = inject(UserSessionService);
  private readonly optimizationService: OptimizationService = inject(OptimizationService);
  private readonly objectStoreService: ObjectStoreService = inject(ObjectStoreService);

  readonly NW = NODE_W;
  readonly NH = NODE_H;

  readonly getNodeLabel = getNodeLabel;
  readonly isMissingFormula = isMissingFormula;
  readonly isActiveFactory = isActiveFactory;

  constructor(private readonly matDialog: MatDialog) { }

  readonly nodes = computed(() => {
    const activeLayout = this.userSessionService.activeLayout();
    if (!activeLayout) {
      return [];
    }
    return activeLayout.factories();
  });

  readonly connections = computed(() => {
    const activeLayout = this.userSessionService.activeLayout();
    if (!activeLayout) {
      return [];
    }
    return activeLayout.connections();
  });

  // ── Node state ──────────────────────────────────────────────────────────────

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

  /** Node whose output port was clicked — awaiting a target input port click. */
  pendingFrom: {
    node: FactoryCanvasNode,
    outputId: number
  } | null = null;
  /** Current mouse position on the canvas-world, used to draw the in-progress arrow. */
  pendingMouse = { x: 0, y: 0 };

  // ── Selection & clipboard ────────────────────────────────────────────────────

  /** The currently selected node's id, or null when nothing is selected. */
  readonly selectedNodeId = signal<string | null>(null);
  /** The last node that was copied with Ctrl+C. */
  private copiedNode: FactoryCanvasNode | null = null;

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
    this.selectedNodeId.set(null);
  }

  @HostListener('document:keydown.control.c')
  onCopy(): void {
    const id = this.selectedNodeId();
    if (!id) return;
    this.copiedNode = this.nodes().find(n => n.id === id) ?? null;
  }

  @HostListener('document:keydown.control.v')
  onPaste(): void {
    if (!this.copiedNode) return;
    this.userSessionService.duplicateNode(this.copiedNode, 24, 24);
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
    this.userSessionService.updateNode(node);
  }

  onDragEnded(ev: CdkDragEnd, node: FactoryCanvasNode): void {
    const p = ev.source.getFreeDragPosition();
    // Absorb the CDK transform into the stored absolute position …
    node.x += p.x;
    node.y += p.y;
    // … then reset freeDragPos and let CDK reset its own internal transform.
    node.freeDragPos = { x: 0, y: 0 };
    ev.source.reset();
    this.userSessionService.updateNode(node);
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
    this.userSessionService.createConnection(this.pendingFrom.node, this.pendingFrom.outputId, node, inputId);
    this.pendingFrom = null;
  }

  deleteConn(id: string, ev: MouseEvent): void {
    ev.stopPropagation();
    this.userSessionService.removeConnection(id);
  }

  hasOutgoing(nodeId: string, outputId: number): boolean {
    return this.connections().some(c => c.fromId === nodeId && c.fromOutputId === outputId);
  }

  // ── Pan (scroll canvas by dragging its background) ──────────────────────────

  /** True while the user is panning the canvas background. */
  isPanning = false;
  /** Set to true once the pointer actually moves during a pan (prevents
   *  deselectAll from firing on a simple click-without-drag). */
  private hasPanned = false;
  private panStartMouse = { x: 0, y: 0 };
  private panStartScroll = { x: 0, y: 0 };

  ngAfterViewInit(): void {
    // touchmove must be registered as non-passive so we can call preventDefault()
    // and prevent the browser from scrolling the page while panning the canvas.
    this.canvasWorldRef.nativeElement.addEventListener(
      'touchmove',
      (ev: TouchEvent) => this.onCanvasTouchMove(ev),
      { passive: false },
    );
  }

  onCanvasMouseDown(ev: MouseEvent): void {
    // Only pan when clicking directly on the canvas background (not a node / SVG interactive element)
    if (ev.target !== this.canvasWorldRef.nativeElement) return;
    if (this.pendingFrom) return;
    this.isPanning = true;
    this.hasPanned = false;
    this.panStartMouse = { x: ev.clientX, y: ev.clientY };
    const el = this.canvasContainerRef.nativeElement;
    this.panStartScroll = { x: el.scrollLeft, y: el.scrollTop };
    ev.preventDefault(); // prevent accidental text selection while dragging
  }

  @HostListener('document:mouseup')
  onMouseUp(): void {
    this.isPanning = false;
  }

  onCanvasTouchStart(ev: TouchEvent): void {
    if (ev.touches.length !== 1 || this.pendingFrom) return;
    const touch = ev.touches[0];
    this.isPanning = true;
    this.hasPanned = false;
    this.panStartMouse = { x: touch.clientX, y: touch.clientY };
    const el = this.canvasContainerRef.nativeElement;
    this.panStartScroll = { x: el.scrollLeft, y: el.scrollTop };
  }

  private onCanvasTouchMove(ev: TouchEvent): void {
    if (!this.isPanning || ev.touches.length !== 1) return;
    ev.preventDefault(); // prevent native page scroll / zoom
    const touch = ev.touches[0];
    const el = this.canvasContainerRef.nativeElement;
    el.scrollLeft = this.panStartScroll.x - (touch.clientX - this.panStartMouse.x);
    el.scrollTop = this.panStartScroll.y - (touch.clientY - this.panStartMouse.y);
    this.hasPanned = true;
  }

  onCanvasTouchEnd(): void {
    this.isPanning = false;
  }

  // ── Mouse tracking ──────────────────────────────────────────────────────────

  onMouseMove(ev: MouseEvent): void {
    if (this.isPanning) {
      const el = this.canvasContainerRef.nativeElement;
      el.scrollLeft = this.panStartScroll.x - (ev.clientX - this.panStartMouse.x);
      el.scrollTop = this.panStartScroll.y - (ev.clientY - this.panStartMouse.y);
      this.hasPanned = true;
      return;
    }
    if (!this.pendingFrom) return;
    const rect = this.canvasWorldRef.nativeElement.getBoundingClientRect();
    this.pendingMouse = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  // ── Node CRUD ───────────────────────────────────────────────────────────────
  addNode(): void {
    this.optimizationService.loadUniverse().then(universe => {
      const ref = this.matDialog.open<ItemSelectDialog, ItemSelectDialogData, ItemSelectDialogResult>(
        ItemSelectDialog,
        {
          data: {
            title: 'Select a factory',
            items: _.concat(
              Object.keys(universe.factories),
              Object.keys(universe.modulators),
              this.objectStoreService.listLayoutIds().filter(it => it !== this.userSessionService.activeLayout()!.id),
            ),
          },
          width: '420px',
          height: '65vh',
          maxWidth: '95vw',
          maxHeight: '90vh',
        }
      );

      ref.afterClosed().subscribe(result => {
        if (!result) return;
        if (_.hasIn(universe.factories, result.label)) {
          const factory = universe.factories[result.label];
          this.userSessionService.addNewFactory(factory, null);
        } else if (_.hasIn(universe.modulators, result.label)) {
          const modulator = universe.modulators[result.label];
          this.userSessionService.addModulator(modulator)
        } else {

        }
      });
    });
  }

  reorganize(): void {
    this.optimizationService.loadUniverse().then(universe => {
      // Step 1: create all missing supplier factories and connect them
      this.userSessionService.fillAllMissingFactories(universe);

      // Step 2: reposition every node in the DAG
      return this.optimizationService.reorganizeNodes(this.userSessionService.activeLayout());
    }).then(newLayout => {
      this.userSessionService.applyOptimizedLayout(newLayout);
    });
  }

  selectNode(node: FactoryCanvasNode, ev: MouseEvent): void {
    ev.stopPropagation();
    this.selectedNodeId.set(node.id);
  }

  deselectAll(): void {
    // A pan gesture ends with a click event — ignore it so we don't clear selection.
    if (this.hasPanned) {
      this.hasPanned = false;
      return;
    }
    this.selectedNodeId.set(null);
    this.pendingFrom = null;
  }

  deleteNode(node: FactoryCanvasNode, ev: MouseEvent): void {
    ev.stopPropagation();
    this.userSessionService.removeNode(node);

    if (this.pendingFrom?.node.id === node.id) this.pendingFrom = null;
    if (this.selectedNodeId() === node.id) this.selectedNodeId.set(null);
    if (this.copiedNode?.id === node.id) this.copiedNode = null;
  }

  trackById = (_: number, item: { id: string }) => item.id;

  getNodeProblem(node: FactoryCanvasNode): string {
    return this.userSessionService.factoryProblems()[node.id];
  }

  startFormulaChange(node: FactoryCanvasNode) {
    this.optimizationService.loadUniverse().then(universe => {
      const ref = this.matDialog.open<ItemSelectDialog, ItemSelectDialogData, ItemSelectDialogResult>(
        ItemSelectDialog,
        {
          data: {
            title: 'Select a recipe',
            subTitle: 'Select a variant',
            items: Object.values(universe.resources)
              .filter(r => r.createdIn.id === node.factory.id)
              .map(r => r.productionVariants?.length
                ? { label: r.id, subItems: ['Normal', ...r.productionVariants.map(v => v.name)] }
                : r.id
              ),
          },
          width: '420px',
          height: '65vh',
          maxWidth: '95vw',
          maxHeight: '90vh',
        }
      );

      ref.afterClosed().subscribe(result => {
        if (!result) return;
        const resource = universe.resources[result.label];
        (<ActiveFactory>node.factory).activeRecipe.set(resource);
        (<ActiveFactory>node.factory).activeProductionVariant.set(result.subItem === 'Normal' ? null : result.subItem);
        this.userSessionService.updateNode(node);
      });
    });
  }
}
