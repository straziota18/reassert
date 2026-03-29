import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { ActiveFactory, FactoryLayout, VirtualFactory } from '../../services/model';
import { ObjectStoreService } from '../../services/object-store-service';

export interface InventoryRow {
  type: 'active' | 'virtual';
  factoryId: string;
  resource: string;
  count: number;
  layouts: string;
}

@Component({
  selector: 'app-factory-inventory',
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
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

  readonly expandVirtual = signal(false);
  readonly loading = signal(false);
  readonly rows = signal<InventoryRow[]>([]);

  readonly displayedColumns = ['type', 'factoryId', 'resource', 'count', 'layouts'];

  ngOnInit(): void {
    this.loadData();
  }

  onExpandVirtualChange(checked: boolean): void {
    this.expandVirtual.set(checked);
    this.loadData();
  }

  async loadData(): Promise<void> {
    this.loading.set(true);
    try {
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
              const vLayout = await this.objectStore.loadLayout(vf.layoutId).catch(() => null);
              if (vLayout) {
                await processLayout(vLayout);
              }
            } else {
              const outputStr =
                vf.outputs.length > 0
                  ? vf.outputs.map(o => `${o.resource.id} (${o.amountPerMinute}/min)`).join(', ')
                  : '(no outputs)';
              virtualRows.push({
                type: 'virtual',
                factoryId: vf.id,
                resource: outputStr,
                count: 1,
                layouts: vf.layoutId,
              });
            }
          } else {
            // ActiveFactory
            const af = factory as ActiveFactory;
            const recipe = af.activeRecipe();
            const resourceId = recipe ? recipe.id : '(no recipe)';
            const key = `${af.id}::${resourceId}`;
            const existing = activeMap.get(key);

            if (existing) {
              existing.count++;
              const current = existing.layouts.split(', ');
              if (!current.includes(layout.id)) {
                existing.layouts = [...current, layout.id].join(', ');
              }
            } else {
              activeMap.set(key, {
                type: 'active',
                factoryId: af.id,
                resource: resourceId,
                count: 1,
                layouts: layout.id,
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
