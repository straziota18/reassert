import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { ObjectStoreService } from './object-store-service';
import { OptimizationService } from './optimization-service';
import { ActiveFactory, activeFactoryActiveRecipeSignal, Connection, createActiveFactory, Factory, FactoryCanvasNode, FactoryLayout, isActiveFactory, isModulator, isVirtualLayout, Modulator, modulatorActiveRecipeSignal, Resource, VirtualFactory, virtualFactoryActiveRecipeSignal } from './model';
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
    // TODO only recompute problems when connections have created/deleted, factorties have been created/deleted, recipes have been changed
    if (activeLayout === null) {
      return {};
    }
    const connections = activeLayout.connections();
    const factories = activeLayout.factories();

    const nodeById = new Map(factories.map(f => [f.id, f]));
    const result: { [factoryId: string]: string } = {};

    const computeUpstreamRequirements = (fromId: string, fromOutputId: number, visited = new Set<string>()): { [resouceId: string]: number } => {
      if (visited.has(fromId)) return {}; // guard against cycles
      const sourceNode = nodeById.get(fromId);
      if (!sourceNode) return {};

      const upstreamConnections = connections.filter(c => c.fromId === fromId && c.fromOutputId === fromOutputId);
      if (!upstreamConnections) return {};

      const result: {[resId: string]: number} = {};
      for (const conn of upstreamConnections) { // this loop should only contain 1 item
        const targetNode = nodeById.get(conn.toId);
        if (!targetNode) continue;

        if (isModulator(targetNode)) {
          const modulator = targetNode.factory as Modulator;
          const newVisited = new Set(visited).add(fromId);
          for (let outputId = 0; outputId < modulator.nbOutputs; outputId++) {
            const targetRequirements = computeUpstreamRequirements(targetNode.id, outputId, newVisited);
            Object.keys(targetRequirements).forEach(resId => {
              if (!result[resId]) {
                result[resId] = 0.0;
              }
              result[resId] += targetRequirements[resId];
            });
          }
        } else if (isActiveFactory(targetNode)) {
          const af = (targetNode.factory as ActiveFactory);
          const activeRecipe = af.activeRecipe();
          if (!activeRecipe) continue
          const nbCyclesPerMin = 60 / activeRecipe.productionCycle.seconds;
          return _.fromPairs(activeRecipe.requires.map(req => [req.input.id, req.amountPerCycle * nbCyclesPerMin]))
        }
      }
      return result;
    }

    const computeOutputRate = (fromId: string, fromOutputId: number, visited = new Set<string>()): { [resourceId: string]: number } => {
      if (visited.has(fromId)) return {}; // guard against cycles
      const sourceNode = nodeById.get(fromId);
      if (!sourceNode) return {};

      if (isVirtualLayout(sourceNode)) {
        const output = (sourceNode.factory as VirtualFactory).outputs[fromOutputId];
        return output ? { [output.resource.id]: output.amountPerMinute } : {};
      } else if (isActiveFactory(sourceNode)) {
        const srcFactory = sourceNode.factory as ActiveFactory;
        const srcRecipe = srcFactory.activeRecipe();
        if (!srcRecipe) return {};
        const variant = srcFactory.activeProductionVariant();
        const pv = variant ? srcRecipe.productionVariants?.find(v => v.name === variant) : null;
        const cycleSeconds = pv ? pv.seconds : srcRecipe.productionCycle.seconds;
        const cycleUnits = pv ? pv.nbUnits : srcRecipe.productionCycle.nbUnits;
        return { [srcRecipe.id]: (60 / cycleSeconds) * cycleUnits }; // theoretical... if issues downstream, output rate is lower
      } else {
        // Modulator: aggregate all incoming rates and substract demand from other recipients
        const modulator = sourceNode.factory as Modulator;
        if (modulator.nbOutputs === 0) return {};
        const newVisited = new Set(visited).add(fromId);

        const externalConsumers: {[resId: string]: number} = {};
        for (let outputId = 0; outputId < modulator.nbOutputs; outputId++) {
          if (outputId === fromOutputId){ 
            continue;
          }

          const outputConsumers = computeUpstreamRequirements(fromId, outputId);
          Object.keys(outputConsumers).forEach(resId => {
            if (!externalConsumers[resId]) {
              externalConsumers[resId] = 0.0;
            }
            externalConsumers[resId] += outputConsumers[resId];
          });
        }
        const modulatorResult: { [resourceId: string]: number } = {};
        for (const incomingConnection of connections.filter(c => c.toId === fromId)) {
          const currentOutput = computeOutputRate(incomingConnection.fromId, incomingConnection.fromOutputId, newVisited);
          for (const [resId, rate] of _.toPairs(currentOutput)) {
            if (!modulatorResult[resId]) {
              modulatorResult[resId] = 0.0;
            }
            modulatorResult[resId] += rate;
          }
        }
        return _.fromPairs(_.toPairs(modulatorResult).map(([resId, rate]) => [resId, rate - (externalConsumers[resId] || 0.0)]));
      }
    };

    const getOutputResourceIds = (fromId: string, fromOutputId: number, visited = new Set<string>()): Set<string> => {
      if (visited.has(fromId)) return new Set();
      const sourceNode = nodeById.get(fromId);
      if (!sourceNode) return new Set();

      if (isVirtualLayout(sourceNode)) {
        const output = (sourceNode.factory as VirtualFactory).outputs[fromOutputId];
        return output ? new Set([output.resource.id]) : new Set();
      } else if (isActiveFactory(sourceNode)) {
        const recipe = (sourceNode.factory as ActiveFactory).activeRecipe();
        return recipe ? new Set([recipe.id]) : new Set();
      } else {
        // Modulator: union of all resources from every incoming connection
        const newVisited = new Set(visited).add(fromId);
        const resourceIds = new Set<string>();
        for (const inConn of connections.filter(c => c.toId === fromId)) {
          for (const rid of getOutputResourceIds(inConn.fromId, inConn.fromOutputId, newVisited)) {
            resourceIds.add(rid);
          }
        }
        return resourceIds;
      }
    };

    for (const node of factories) {
      // TODO compute bottlenecks on modulators... long term
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

      // Check 2: Missing inputs — verify the required resource is actually being injected
      const missingCount = requiredInputs.filter((req, idx) => {
        const connsForSlot = incomingConnections.filter(c => c.toInputId === idx);
        if (connsForSlot.length === 0) return true;
        return !connsForSlot.some(conn => getOutputResourceIds(conn.fromId, conn.fromOutputId).has(req.input.id));
      }).length;

      if (missingCount > 0) {
        result[node.id] = `Missing ${missingCount}/${requiredInputs.length} inputs`;
        continue;
      }

      // Check 3: Inputs are too low — compare effective supply rate vs required rate
      const cyclesPerMin = 60 / recipe.productionCycle.seconds;
      const missingInputsPerMin = _.fromPairs(requiredInputs.map(r => [r.input.id, r.amountPerCycle * cyclesPerMin]))

      for (let inputIdx = 0; inputIdx < requiredInputs.length; inputIdx++) {
        const connectionsToInput = incomingConnections.filter(c => c.toInputId === inputIdx);

        for (const conn of connectionsToInput) {
          const sourceOutputRate = computeOutputRate(conn.fromId, conn.fromOutputId);
          for (const [resId, rate] of _.toPairs(sourceOutputRate)) {
            if (!missingInputsPerMin[resId]) {
              continue;
            }
            missingInputsPerMin[resId] -= rate;
          }
        }
      }

      const incompleteInputs = Object.values(missingInputsPerMin).filter(v => v > 0);
      if (incompleteInputs.length > 0) {
        result[node.id] = `${incompleteInputs.length}/${requiredInputs.length} inputs are too low`;
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
