import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { ActiveFactory, FactoryLayout, VirtualFactory } from '../../services/model';
import { ObjectStoreService } from '../../services/object-store-service';
import * as _ from 'lodash';

export interface InventoryRow {
  type: 'active' | 'virtual';
  factoryId: string;
  resource: string;
  count: number;
}

@Component({
  selector: 'app-factory-inventory',
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatSortModule,
    MatToolbarModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatIconModule,
  ],
  templateUrl: './factory-inventory.html',
  styleUrl: './factory-inventory.scss',
})
export class FactoryInventory implements OnInit {
  private readonly objectStore = inject(ObjectStoreService);

  readonly groupByType = signal(false);
  readonly expandVirtual = signal(false);
  readonly loading = signal(false);
  readonly rows = signal<InventoryRow[]>([]);
  readonly sortState = signal<Sort>({ active: '', direction: '' });

  readonly displayedColumns = computed(() => {
    return this.groupByType() ? ['type', 'factoryId', 'count', 'layouts'] : ['type', 'factoryId', 'resource', 'count', 'layouts'];
  });

  readonly sortedRows = computed<InventoryRow[]>(() => {
    const rows = this.rows();
    const sort = this.sortState();
    if (!sort.active || sort.direction === '') return rows;
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sort.active) {
        case 'type': return dir * a.type.localeCompare(b.type);
        case 'factoryId': return dir * a.factoryId.localeCompare(b.factoryId);
        case 'resource': return dir * a.resource.localeCompare(b.resource);
        case 'count': return dir * (a.count - b.count);
        default: return 0;
      }
    });
  });

  onSortChange(sort: Sort): void {
    this.sortState.set(sort);
  }

  ngOnInit(): void {
    this.loadData();
  }

  onGroupByTypeChange(checked: boolean) {
    this.groupByType.set(checked);
    this.loadData();
  }

  onExpandVirtualChange(checked: boolean): void {
    this.expandVirtual.set(checked);
    this.loadData();
  }

  async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const groupByType = this.groupByType();
      const layoutIds = this.objectStore.listLayoutIds();
      const layouts = (
        await Promise.all(layoutIds.map(id => this.objectStore.loadLayout(id).catch(() => null)))
      ).filter((l): l is FactoryLayout => l !== null);

      const activeMap = new Map<string, InventoryRow>();
      const virtualRows: InventoryRow[] = [];

      const processLayout = async (layout: FactoryLayout): Promise<void> => {
        for (const node of layout.factories()) {
          const factory = node.factory;

          if ('outputs' in factory) {
            // VirtualFactory
            const vf = factory as VirtualFactory;
            if (this.expandVirtual()) {
              const vLayout = await this.objectStore.loadLayout(vf.id).catch(() => null);
              if (vLayout) {
                await processLayout(vLayout);
              }
            } else {
              const outputStr =
                !groupByType && vf.outputs.length > 0
                  ? vf.outputs.map(o => o.resource.id).join(', ')
                  : '(no outputs)';
              virtualRows.push({
                type: 'virtual',
                factoryId: vf.id,
                resource: outputStr,
                count: 1,
              });
            }
          } else if (!_.hasIn(factory, 'nbOutputs')) {
            // ActiveFactory
            const af = factory as ActiveFactory;
            const recipe = af.activeRecipe();
            const resourceId = recipe && !groupByType ? recipe.id : '(no recipe)';
            const key = `${af.id}::${resourceId}`;
            const existing = activeMap.get(key);

            if (existing) {
              existing.count++;
            } else {
              activeMap.set(key, {
                type: 'active',
                factoryId: af.id,
                resource: resourceId,
                count: 1,
              });
            }
          }
        }
      };

      for (const layout of layouts) {
        await processLayout(layout);
      }

      this.rows.set([...activeMap.values(), ...virtualRows]);
    } finally {
      this.loading.set(false);
    }
  }
}
