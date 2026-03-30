import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, filter, firstValueFrom, forkJoin, map } from 'rxjs';
import { Factory, Modulator, Resource, Universe } from './model';
import * as _ from 'lodash';

interface RawResource {
  id: string;
  createdIn: string;
  requires: { input: string; amountPerCycle: number }[];
  productionCycle: { seconds: number; nbUnits: number };
}

@Injectable({
  providedIn: 'root',
})
export class OptimizationService {
  private readonly http = inject(HttpClient);
  private readonly BASE = 'assets/star-rupture';

  private readonly universe$ = new BehaviorSubject<Universe | null>(null);
  private readonly worker = new Worker(new URL('./optimizer.worker', import.meta.url));

  loadUniverse(): Promise<Universe> {
    if (!this.universe$.value) {
      forkJoin({
        factories: this.http.get<Factory[]>(`${this.BASE}/factories.json`),
        resources: this.http.get<RawResource[]>(`${this.BASE}/resources.json`),
        modulators: this.http.get<Modulator[]>(`${this.BASE}/modulators.json`),
      })
        .pipe(
          map(({ factories, resources, modulators }) => {
            // Index factories by ID for O(1) lookup
            const factoryMap = new Map<string, Factory>(factories.map(f => [f.id, f]));

            // Pass 1 — create all Resource shells with empty requires[]
            // so that circular/forward references can be resolved in pass 2
            const resourceMap = new Map<string, Resource>();
            for (const raw of resources) {
              const resource: Resource = {
                id: raw.id,
                createdIn: factoryMap.get(raw.createdIn)!,
                requires: [],
                productionCycle: raw.productionCycle,
              };
              resourceMap.set(raw.id, resource);
            }

            // Pass 2 — resolve requires[] input strings to actual Resource objects
            for (const raw of resources) {
              const resource = resourceMap.get(raw.id)!;
              resource.requires = raw.requires.map(r => ({
                input: resourceMap.get(r.input)!,
                amountPerCycle: r.amountPerCycle,
              }));
            }

            return {
              factories: _.zipObject(factories.map(it => it.id), factories),
              resources: Object.fromEntries(resourceMap.entries()),
              modulators: _.zipObject(modulators.map(it => it.id), modulators),
            } satisfies Universe;
          })
        )
        .subscribe(universe => this.universe$.next(universe));
    }

    return firstValueFrom(this.universe$.pipe(filter((u): u is Universe => u !== null)));
  }
}
