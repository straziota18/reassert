import { inject, Injectable, signal } from '@angular/core';
import {
  ActiveFactory,
  Connection,
  FactoryCanvasNode,
  FactoryLayout,
  VirtualFactory,
} from './model';
import { OptimizationService } from './optimization-service';

// ---------------------------------------------------------------------------
// Serialization types – stored verbatim in localStorage
// ---------------------------------------------------------------------------

interface SerializedActiveFactory {
  type: 'active';
  /** References a Factory id owned by OptimizationService */
  id: string;
  /** null when no recipe has been selected */
  activeRecipeId: string | null;
}

interface SerializedVirtualFactory {
  type: 'virtual';
  id: string;
  /** Id of the FactoryLayout this virtual factory belongs to. */
  layoutId: string;
  outputs: { resourceId: string; amountPerMinute: number }[];
}

interface SerializedFactoryCanvasNode {
  id: string;
  factory: SerializedActiveFactory | SerializedVirtualFactory;
  x: number;
  y: number;
  freeDragPos: { x: number; y: number };
}

interface SerializedFactoryLayout {
  id: string;
  /** Connection is already flat (only contains primitive IDs) */
  connections: Connection[];
  factories: SerializedFactoryCanvasNode[];
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
      connections: layout.connections.map(c => ({ ...c })),
      factories: layout.factories.map(n => this.serializeNode(n)),
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
    factory: ActiveFactory | VirtualFactory,
  ): SerializedActiveFactory | SerializedVirtualFactory {
    if ('outputs' in factory) {
      // VirtualFactory
      const vf = factory as VirtualFactory;
      return {
        type: 'virtual',
        id: vf.id,
        layoutId: vf.layoutId,
        outputs: vf.outputs.map(o => ({
          resourceId: o.resource.id,
          amountPerMinute: o.amountPerMinute,
        })),
      } satisfies SerializedVirtualFactory;
    } else {
      // ActiveFactory
      const af = factory as ActiveFactory;
      const recipe = af.activeRecipe();
      return {
        type: 'active',
        id: af.id,
        activeRecipeId: recipe ? recipe.id : null,
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
        const factories = serialized.factories.map(sn =>
          this.deserializeNode(sn, universe),
        );

        resolve({
          id: serialized.id,
          connections: serialized.connections.map(c => ({ ...c })),
          factories,
        });
      }).catch(err => reject(err));


    });
  }

  private deserializeNode(
    sn: SerializedFactoryCanvasNode,
    universe: Awaited<ReturnType<OptimizationService['loadUniverse']>>,
  ): FactoryCanvasNode {
    return {
      id: sn.id,
      factory: this.deserializeFactory(sn.factory, universe),
      x: sn.x,
      y: sn.y,
      freeDragPos: { ...sn.freeDragPos },
    };
  }

  private deserializeFactory(
    sf: SerializedActiveFactory | SerializedVirtualFactory,
    universe: Awaited<ReturnType<OptimizationService['loadUniverse']>>,
  ): ActiveFactory | VirtualFactory {
    if (sf.type === 'virtual') {
      const vf = sf as SerializedVirtualFactory;
      return {
        id: vf.id,
        layoutId: vf.layoutId,
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
