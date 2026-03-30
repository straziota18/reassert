import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import {
  ActiveFactory,
  activeFactoryActiveRecipeSignal,
  Connection,
  FactoryCanvasNode,
  FactoryLayout,
  Modulator,
  modulatorActiveRecipeSignal,
  VirtualFactory,
  virtualFactoryActiveRecipeSignal,
} from './model';
import { OptimizationService } from './optimization-service';
import * as _ from 'lodash';

// ---------------------------------------------------------------------------
// Serialization types – stored verbatim in localStorage
// ---------------------------------------------------------------------------

interface SerializedActiveFactory {
  type: 'active';
  /** References a Factory id owned by OptimizationService */
  id: string;
  /** null when no recipe has been selected */
  activeRecipeId: string | null;
  /** null means use the default productionCycle (Normal node) */
  activeProductionVariantName: string | null;
}

interface SerializedVirtualFactory {
  type: 'virtual';
  id: string;
  outputs: { resourceId: string; amountPerMinute: number }[];
}

interface SerializedModulator {
  type: 'modulator';
  id: string;
}

interface SerializedFactoryCanvasNode {
  id: string;
  factory: SerializedActiveFactory | SerializedVirtualFactory | SerializedModulator;
  x: number;
  y: number;
  freeDragPos: { x: number; y: number };
}

interface SerializedFactoryLayout {
  id: string;
  /** Connection is already flat (only contains primitive IDs) */
  connections: Connection[];
  factories: SerializedFactoryCanvasNode[];
  targets: {[resourceId: string]: number};
}

// ---------------------------------------------------------------------------
// Storage key helpers
// ---------------------------------------------------------------------------

const INDEX_KEY = 'reassert:layout-index';
const layoutKey = (id: string) => `reassert:layout:${id}`;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({
  providedIn: 'root',
})
export class ObjectStoreService {
  private readonly optimizationService = inject(OptimizationService);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Returns the ids of all persisted layouts. */
  listLayoutIds(): string[] {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  }

  /** Serializes and persists a FactoryLayout to localStorage. */
  saveLayout(layout: FactoryLayout): void {
    const serialized = this.serializeLayout(layout);
    localStorage.setItem(layoutKey(layout.id), JSON.stringify(serialized));
    this.addToIndex(layout.id);
  }

  /**
   * Loads and deserializes a FactoryLayout from localStorage.
   * Returns null when no layout with the given id exists.
   * Requires the universe to be loaded via OptimizationService so that
   * Resource and Factory objects can be resolved by id.
   */
  loadLayout(id: string): Promise<FactoryLayout | null> {
    return new Promise<FactoryLayout | null>((resolve, reject) => {
      const raw = localStorage.getItem(layoutKey(id));
      if (!raw) {
        reject(`Could not find layout ${id} in local storage`);
        return;
      }

      const serialized = JSON.parse(raw) as SerializedFactoryLayout;
      this.deserializeLayout(serialized).then(it => resolve(it)).catch(err => reject(err));
    });
  }

  /** Removes a layout from localStorage and from the index. */
  deleteLayout(id: string): void {
    localStorage.removeItem(layoutKey(id));
    this.removeFromIndex(id);
  }

  // -------------------------------------------------------------------------
  // Serialization helpers
  // -------------------------------------------------------------------------

  private serializeLayout(layout: FactoryLayout): SerializedFactoryLayout {
    return {
      id: layout.id,
      connections: layout.connections().map(c => ({ ...c })),
      factories: layout.factories().map(n => this.serializeNode(n)),
      targets: _.fromPairs(_.toPairs(layout.targets()).map(([key, value]) => [key, value.target]))
    };
  }

  private serializeNode(node: FactoryCanvasNode): SerializedFactoryCanvasNode {
    return {
      id: node.id,
      factory: this.serializeFactory(node.factory),
      x: node.x,
      y: node.y,
      freeDragPos: { ...node.freeDragPos },
    };
  }

  private serializeFactory(
    factory: ActiveFactory | VirtualFactory | Modulator,
  ): SerializedActiveFactory | SerializedVirtualFactory | SerializedModulator {
    if ('outputs' in factory) {
      // VirtualFactory
      const vf = factory as VirtualFactory;
      return {
        type: 'virtual',
        id: vf.id,
        outputs: vf.outputs.map(o => ({
          resourceId: o.resource.id,
          amountPerMinute: o.amountPerMinute,
        })),
      } satisfies SerializedVirtualFactory;
    } else if ('nbOutputs' in factory) {
      // Modulator
      return {
        type: 'modulator',
        id: factory.id
      } satisfies SerializedModulator;
    } else {
      // ActiveFactory
      const af = factory as ActiveFactory;
      const recipe = af.activeRecipe();
      return {
        type: 'active',
        id: af.id,
        activeRecipeId: recipe ? recipe.id : null,
        activeProductionVariantName: af.activeProductionVariant(),
      } satisfies SerializedActiveFactory;
    }
  }

  // -------------------------------------------------------------------------
  // Deserialization helpers
  // -------------------------------------------------------------------------

  private deserializeLayout(
    serialized: SerializedFactoryLayout,
  ): Promise<FactoryLayout> {
    return new Promise<FactoryLayout>((resolve, reject) => {
      this.optimizationService.loadUniverse().then(universe => {
        const result: FactoryLayout = {
          id: serialized.id,
          connections: signal(serialized.connections.map(c => ({ ...c }))),
          factories: signal([]),
          targets: signal({})
        };
        result.factories.set(serialized.factories.map(sn => this.deserializeNode(result, sn, universe)));
        result.targets.set(_.fromPairs(_.toPairs(serialized.targets).map(([key, value]) => {
          return [key, {resource: universe.resources[key], target: value}];
        })));

        resolve(result);
      }).catch(err => reject(err));


    });
  }

  private deserializeNode(
    currentLayout: FactoryLayout,
    sn: SerializedFactoryCanvasNode,
    universe: Awaited<ReturnType<OptimizationService['loadUniverse']>>,
  ): FactoryCanvasNode {
    const deserializedFactory = this.deserializeFactory(sn.factory, universe);
    let activeFormulaSignal: Signal<string[]>;
    if (_.hasIn(deserializedFactory, 'outputs')) {
      const vf = deserializedFactory as VirtualFactory;
      activeFormulaSignal = virtualFactoryActiveRecipeSignal(vf);
    } else if (_.hasIn(deserializedFactory, 'nbOutputs')) {
      activeFormulaSignal = modulatorActiveRecipeSignal(currentLayout, sn.id);
    } else {
      const af = deserializedFactory as ActiveFactory;
      activeFormulaSignal = activeFactoryActiveRecipeSignal(af);
    }
    return {
      id: sn.id,
      factory: deserializedFactory,
      x: sn.x,
      y: sn.y,
      freeDragPos: { ...sn.freeDragPos },
      activeFormula: activeFormulaSignal 
    };
  }

  private deserializeFactory(
    sf: SerializedActiveFactory | SerializedVirtualFactory | SerializedModulator,
    universe: Awaited<ReturnType<OptimizationService['loadUniverse']>>,
  ): ActiveFactory | VirtualFactory | Modulator {
    if (sf.type === 'virtual') {
      const vf = sf as SerializedVirtualFactory;
      return {
        id: vf.id,
        outputs: vf.outputs.map(o => {
          const resource = universe.resources[o.resourceId];
          if (!resource) {
            throw new Error(
              `ObjectStoreService: unknown resource id "${o.resourceId}" while deserializing VirtualFactory "${vf.id}"`,
            );
          }
          return { resource, amountPerMinute: o.amountPerMinute };
        }),
      } satisfies VirtualFactory;
    } else if (sf.type === 'modulator') {
      const mod = sf as SerializedModulator;
      const baseModulator = universe.modulators[mod.id];
      return {
        ...baseModulator
      } satisfies Modulator;
    } else {
      const saf = sf as SerializedActiveFactory;
      const baseFactory = universe.factories[saf.id];
      if (!baseFactory) {
        throw new Error(
          `ObjectStoreService: unknown factory id "${saf.id}" while deserializing ActiveFactory`,
        );
      }
      const recipe =
        saf.activeRecipeId !== null
          ? (universe.resources[saf.activeRecipeId] ?? null)
          : null;

      return {
        ...baseFactory,
        activeRecipe: signal(recipe),
        activeProductionVariant: signal(saf.activeProductionVariantName ?? null),
      } satisfies ActiveFactory;
    }
  }

  // -------------------------------------------------------------------------
  // Index management
  // -------------------------------------------------------------------------

  private addToIndex(id: string): void {
    const ids = this.listLayoutIds();
    if (!ids.includes(id)) {
      ids.push(id);
      localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
    }
  }

  private removeFromIndex(id: string): void {
    const ids = this.listLayoutIds().filter(i => i !== id);
    localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
  }
}
