import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { ObjectStoreService } from './object-store-service';
import { OptimizationService } from './optimization-service';
import { ActiveFactory, activeFactoryActiveRecipeSignal, Connection, createActiveFactory, Factory, FactoryCanvasNode, FactoryLayout, isActiveFactory, isVirtualLayout, Modulator, modulatorActiveRecipeSignal, Resource, VirtualFactory, virtualFactoryActiveRecipeSignal } from './model';
import * as _ from 'lodash';

const ACTIVE_LAYOUT_KEY = 'reassert:active-layout-id';

@Injectable({
  providedIn: 'root',
})
export class UserSessionService {
  private readonly optimizationService = inject(OptimizationService);
  private readonly objectStoreService = inject(ObjectStoreService);

  readonly activeLayout: WritableSignal<FactoryLayout | null> = signal(null);

  readonly factoryProblems: Signal<{ [factoryId: string]: string }> = computed(() => {
    const activeLayout = this.activeLayout();
    if (activeLayout === null) {
      return {};
    }
    const connections = activeLayout.connections();
    const factories = activeLayout.factories();

    const nodeById = new Map(factories.map(f => [f.id, f]));
    const result: { [factoryId: string]: string } = {};

    for (const node of factories) {
      if (!isActiveFactory(node)) continue;

      const activeFactory = node.factory as ActiveFactory;
      const recipe = activeFactory.activeRecipe();

      // Check 1: No active formula
      if (recipe === null) {
        result[node.id] = 'Factory is idle';
        continue;
      }

      const requiredInputs = recipe.requires;
      if (requiredInputs.length === 0) continue;

      const incomingConnections = connections.filter(c => c.toId === node.id);

      // Check 2: Missing inputs — count how many required input slots have a connection
      const connectedInputIds = new Set(incomingConnections.map(c => c.toInputId));
      const connectedCount = requiredInputs.filter((_, idx) => connectedInputIds.has(idx)).length;

      if (connectedCount < requiredInputs.length) {
        result[node.id] = `Missing ${connectedCount}/${requiredInputs.length} inputs`;
        continue;
      }

      // Check 3: Inputs are too low — compare effective supply rate vs required rate
      const cyclesPerMin = 60 / recipe.productionCycle.seconds;
      let tooLowCount = 0;

      for (let inputIdx = 0; inputIdx < requiredInputs.length; inputIdx++) {
        const requiredAmountPerMin = requiredInputs[inputIdx].amountPerCycle * cyclesPerMin;
        const connectionsToInput = incomingConnections.filter(c => c.toInputId === inputIdx);

        let totalSupply = 0;
        for (const conn of connectionsToInput) {
          const sourceNode = nodeById.get(conn.fromId);
          if (!sourceNode) continue;

          let sourceOutputRate = 0;
          if (isVirtualLayout(sourceNode)) {
            const output = (sourceNode.factory as VirtualFactory).outputs[conn.fromOutputId];
            if (output) sourceOutputRate = output.amountPerMinute;
          } else if (isActiveFactory(sourceNode)) {
            const srcFactory = sourceNode.factory as ActiveFactory;
            const srcRecipe = srcFactory.activeRecipe();
            if (srcRecipe) {
              const variant = srcFactory.activeProductionVariant();
              const pv = variant ? srcRecipe.productionVariants?.find(v => v.name === variant) : null;
              const cycleSeconds = pv ? pv.seconds : srcRecipe.productionCycle.seconds;
              const cycleUnits = pv ? pv.nbUnits : srcRecipe.productionCycle.nbUnits;
              sourceOutputRate = (60 / cycleSeconds) * cycleUnits;
            }
          }

          // Split output evenly among all recipients of this source output port
          const recipientCount = connections.filter(
            c => c.fromId === conn.fromId && c.fromOutputId === conn.fromOutputId
          ).length;
          totalSupply += recipientCount > 0 ? sourceOutputRate / recipientCount : 0;
        }

        if (totalSupply < requiredAmountPerMin) {
          tooLowCount++;
        }
      }

      if (tooLowCount > 0) {
        result[node.id] = `${tooLowCount}/${requiredInputs.length} inputs are too low`;
      }
    }

    return result;
  });

  initialize(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const activeLayoutId = localStorage.getItem(ACTIVE_LAYOUT_KEY);

      if (activeLayoutId) {
        this.objectStoreService.loadLayout(activeLayoutId).then(layout => {
          if (layout !== null) {
            this.activeLayout.set(layout);
          } else {
            this.initEmptyLayout();
          }
        }).catch(_ => {
          this.initEmptyLayout();
        })
      } else {
        this.initEmptyLayout();
      }

      resolve()
    });
  }

  private initEmptyLayout() {
    const newLayout: FactoryLayout = {
      id: 'Global layout',
      factories: signal([]),
      connections: signal([]),
      targets: signal({})
    };

    this.objectStoreService.saveLayout(newLayout);
    localStorage.setItem(ACTIVE_LAYOUT_KEY, newLayout.id);
    this.activeLayout.set(newLayout);
  }

  public updateNode(node: FactoryCanvasNode) {
    const activeLayout = this.activeLayout();
    if (!activeLayout) {
      return;
    }
    const existingFactories = activeLayout.factories();
    if (existingFactories.findIndex(it => it.id === node.id) === -1) {
      throw new Error(`Expecting node ${node.id} to exist in active layout ${activeLayout.id}`);
    }
    activeLayout.factories.set([...existingFactories]);
    this.objectStoreService.saveLayout(activeLayout);
  }

  public removeNode(node: FactoryCanvasNode) {
    const activeLayout = this.activeLayout();
    if (!activeLayout) {
      return;
    }

    activeLayout.factories.update(ns => ns.filter(n => n.id !== node.id));
    activeLayout.connections.update(connections => connections.filter(
      c => c.fromId !== node.id && c.toId !== node.id,
    ));

    this.objectStoreService.saveLayout(activeLayout);
  }

  public createConnection(fromNode: FactoryCanvasNode, fromOutputId: number, toNode: FactoryCanvasNode, toInputId: number) {
    const activeLayout = this.activeLayout();
    if (!activeLayout) {
      return;
    }

    const newConnection: Connection = {
      id: crypto.randomUUID(),
      fromId: fromNode.id,
      fromOutputId: fromOutputId,
      toId: toNode.id,
      toInputId: toInputId
    };
    activeLayout.connections.update(connections => [
      ...connections.filter(c => !(c.toId === toNode.id && c.toInputId === toInputId)),
      newConnection
    ]);
    this.objectStoreService.saveLayout(activeLayout);
  }

  public removeConnection(connectionId: string) {
    const activeLayout = this.activeLayout();
    if (!activeLayout) {
      return;
    }
    activeLayout.connections.update(connections => connections.filter(c => c.id !== connectionId));
    this.objectStoreService.saveLayout(activeLayout);
  }

  /** Builds a new {@link FactoryCanvasNode} without adding it to any layout. */
  private createNode(
    layout: FactoryLayout,
    factoryProvider: () => ActiveFactory | VirtualFactory | Modulator,
    activeFormulaSignalProvider: (layout: FactoryLayout, it: ActiveFactory | VirtualFactory | Modulator, id: string) => Signal<string[]>,
    x: number,
    y: number,
  ): FactoryCanvasNode {
    const factory = factoryProvider();
    const newId = crypto.randomUUID();
    return {
      id: newId,
      factory: factory,
      x,
      y,
      freeDragPos: { x: 0, y: 0 },
      activeFormula: activeFormulaSignalProvider(layout, factory, newId)
    };
  }

  /** Creates a copy of an active-factory node, offset by (offsetX, offsetY). */
  public duplicateNode(source: FactoryCanvasNode, offsetX: number, offsetY: number): void {
    const activeLayout = this.activeLayout();
    if (!activeLayout) return;

    let newNode: FactoryCanvasNode;
    if (isActiveFactory(source)) {
      const srcFactory = source.factory as ActiveFactory;

      newNode = this.createNode(
        activeLayout,
        () => {
          const activeRecipe = srcFactory.activeRecipe();
          const activeFactory = createActiveFactory(srcFactory, activeRecipe);
          const activeVariant = srcFactory.activeProductionVariant();
          activeFactory.activeProductionVariant.set(activeVariant);
          return activeFactory;
        },
        (layout, f, id) => activeFactoryActiveRecipeSignal(f as ActiveFactory),
        source.x + offsetX,
        source.y + offsetY,
      );
    } else if (isVirtualLayout(source)) {
      newNode = this.createNode(
        activeLayout,
        () => {
          return {
            id: source.id,
            outputs: (source.factory as VirtualFactory).outputs
          } satisfies VirtualFactory;
        },
        (layout, f, id) => virtualFactoryActiveRecipeSignal(f as VirtualFactory),
        source.x + offsetX,
        source.y + offsetY,
      );
    } else {
      newNode = this.createNode(
        activeLayout,
        () => {
          return {
            id: source.factory.id,
            nbInputs: (source.factory as Modulator).nbInputs,
            nbOutputs: (source.factory as Modulator).nbOutputs,
          } satisfies Modulator;
        },
        (layout, f, id) => modulatorActiveRecipeSignal(layout, id),
        source.x + offsetX,
        source.y + offsetY,
      );
    }


    activeLayout.factories.update(nodes => [...nodes, newNode]);
    this.objectStoreService.saveLayout(activeLayout);
  }

  public addModulator(modulator: Modulator) {
    const activeLayout = this.activeLayout();
    if (!activeLayout) return;

    const newNode = this.createNode(
      activeLayout,
      () => modulator,
      (layout, f, id) => modulatorActiveRecipeSignal(layout, id),
      0,
      0
    );
    activeLayout.factories.update(nodes => [...nodes, newNode]);
    this.objectStoreService.saveLayout(activeLayout);
  }

  public addNewFactory(factory: Factory, activeRecipe: Resource | null) {
    const activeLayout = this.activeLayout();
    if (!activeLayout) return;

    if (activeRecipe) {
      const cyclesPerMin = 60 / activeRecipe.productionCycle.seconds;
      activeLayout.targets.update(targets => _.set(targets, activeRecipe.id, {
        resource: activeRecipe,
        target: cyclesPerMin * activeRecipe.productionCycle.nbUnits,
      }));
    }

    const newNode = this.createNode(
      activeLayout,
      () => {
          const activeFactory = createActiveFactory(factory, activeRecipe);
          activeFactory.activeProductionVariant.set(null);
          return activeFactory;
      },
      (layout, f, id) => activeFactoryActiveRecipeSignal(f as ActiveFactory),
      0,
      0
    );
    activeLayout.factories.update(nodes => [...nodes, newNode]);
    this.objectStoreService.saveLayout(activeLayout);
  }
}
