import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { ObjectStoreService } from './object-store-service';
import { OptimizationService } from './optimization-service';
import { Connection, createActiveFactory, Factory, FactoryCanvasNode, FactoryLayout, FactoryProblem, isActiveFactory, Resource, VirtualFactory } from './model';
import * as _ from 'lodash';

const ACTIVE_LAYOUT_KEY = 'reassert:active-layout-id';

@Injectable({
  providedIn: 'root',
})
export class UserSessionService {
  private readonly optimizationService = inject(OptimizationService);
  private readonly objectStoreService = inject(ObjectStoreService);

  readonly activeLayout: WritableSignal<FactoryLayout | null> = signal(null);

  readonly problems: Signal<{[factoryId: string]: FactoryProblem}> = computed(() => {
    const activeLayout = this.activeLayout();
    if (activeLayout === null) {
      return {};
    }
    const connections = activeLayout.connections();
    const factories = activeLayout.factories();
    const factoryProductions: {[factoryId: string]: {
      [resouceId: string]: {
        productionPerMinute: number,
        consumptionPerMinute: number,
      }
    }} = _.fromPairs(factories.map(f => {
      if (isActiveFactory(f)) {
        return [];
      } else {
        const virtualFactory = f.factory as VirtualFactory;
        const outputs = virtualFactory.outputs.map(it => {
          return [it.resource.id, it.amountPerMinute];
        });
        return [f.id, _.fromPairs(outputs)];
      }
    }));
    return _.fromPairs(factories.filter(it => isActiveFactory(it)).map(f => {
      const incomingConnections = connections.filter(it => it.toId === f.id);
      return [f.id, ''];
    }).filter(a => a.length === 2));
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

  public addNewFactory(factory: Factory, activeRecipe: Resource | null) {
    const activeLayout = this.activeLayout();
    if (!activeLayout) {
      return;
    }
    if (activeRecipe) {
      // is new target
      const cyclesPerMin = 60 / activeRecipe.productionCycle.seconds;
      activeLayout.targets.update(targets => _.set(targets, activeRecipe.id, cyclesPerMin * activeRecipe.productionCycle.nbUnits));
    }
    activeLayout.factories.update((existingFactories) => {
      const activeFactory = createActiveFactory(factory, activeRecipe);
      const newFactory: FactoryCanvasNode = {
        id: crypto.randomUUID(),
        factory: activeFactory,
        x: 0,
        y: 0,
        freeDragPos: { x: 0, y: 0 },
        activeFormula: computed(() => {
          const r = activeFactory.activeRecipe();
          return r === null ? 'No recipe selected' : r.id;
        })
      };
      return [...existingFactories, newFactory];
    });

    this.objectStoreService.saveLayout(activeLayout);
  }
}
