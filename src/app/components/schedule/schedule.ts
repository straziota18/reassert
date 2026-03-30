import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ItemSelectDialog, ItemSelectDialogData, ItemSelectDialogResult } from '../item-select-dialog/item-select-dialog';
import { ActiveFactory, FactoryCanvasNode, Resource, VirtualFactory } from '../../services/model';
import { OptimizationService } from '../../services/optimization-service';
import { UserSessionService } from '../../services/user-session-service';
import * as _ from 'lodash';

export interface ScheduleRow {
  factoryId: string;
  resource: string;
  targetPerMin: number;
  producedPerMin: number;
  consumedPerMin: number;
  nbFactories: number;
  /** One representative factory node for this row (used for add/remove operations). */
  sampleFactoryNode: FactoryCanvasNode | null;
}

const createScheduleRow: (resource: Resource) => ScheduleRow = (resource: Resource) => {
  return {
    consumedPerMin: 0.0,
    producedPerMin: 0.0,
    targetPerMin: 0.0,
    factoryId: resource.createdIn.id,
    resource: resource.id,
    nbFactories: 0,
    sampleFactoryNode: null,
  }
}

@Component({
  selector: 'app-schedule',
  imports: [
    CommonModule,
    MatDialogModule,
    MatTableModule,
    MatSortModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
  ],
  templateUrl: './schedule.html',
  styleUrl: './schedule.scss',
})
export class Schedule {
  private readonly dialog = inject(MatDialog);
  private readonly optimizationService = inject(OptimizationService);
  private readonly userSession = inject(UserSessionService);

  readonly displayedColumns = ['factoryId', 'nbFactories', 'resource', 'targetPerMin', 'netPerMin'];

  readonly sortState = signal<Sort>({ active: '', direction: '' });

  readonly sortedRows = computed<ScheduleRow[]>(() => {
    const rows = this.rows();
    const sort = this.sortState();
    if (!sort.active || sort.direction === '') return rows;
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sort.active) {
        case 'factoryId': return dir * a.factoryId.localeCompare(b.factoryId);
        case 'resource':  return dir * a.resource.localeCompare(b.resource);
        case 'nbFactories': return dir * (a.nbFactories - b.nbFactories);
        case 'targetPerMin': return dir * (a.targetPerMin - b.targetPerMin);
        case 'netPerMin':
          return dir * ((a.producedPerMin - a.consumedPerMin) - (b.producedPerMin - b.consumedPerMin));
        default: return 0;
      }
    });
  });

  onSortChange(sort: Sort): void {
    this.sortState.set(sort);
  }

  readonly rows = computed<ScheduleRow[]>(() => {
    const layout = this.userSession.activeLayout();
    if (!layout) return [];

    const rows: { [resourceId: string]: ScheduleRow } = {};
    const targets = layout.targets();
    for (const [resourceId, target] of _.toPairs(targets)) {
      if (!rows[resourceId]) {
        rows[resourceId] = createScheduleRow(targets[resourceId].resource);
      }
      rows[resourceId].targetPerMin = target.target;
    }

    for (const node of layout.factories()) {
      const factory = node.factory;

      if ('outputs' in factory) {
        // VirtualFactory – each declared output is a production row
        const vf = factory as VirtualFactory;
        for (const output of vf.outputs) {
          if (!rows[output.resource.id]) {
            rows[output.resource.id] = createScheduleRow(output.resource);
          }
          rows[output.resource.id].producedPerMin += output.amountPerMinute;
        }
      } else if (!_.hasIn(factory, 'nbOutputs')) {
        // ActiveFactory – derive rates from the active recipe's production cycle
        const af = factory as ActiveFactory;
        const recipe = af.activeRecipe();

        if (recipe) {
          // Resolve the active production variant (null → use default productionCycle)
          const variantName = af.activeProductionVariant();
          const activeCycle = variantName && recipe.productionVariants
            ? (recipe.productionVariants.find(v => v.name === variantName) ?? recipe.productionCycle)
            : recipe.productionCycle;
          const cyclesPerMin = 60 / activeCycle.seconds;

          // One row for the produced resource
          if (!rows[recipe.id]) {
            rows[recipe.id] = createScheduleRow(recipe);
          }
          rows[recipe.id].producedPerMin += activeCycle.nbUnits * cyclesPerMin;
          rows[recipe.id].nbFactories += 1;
          if (!rows[recipe.id].sampleFactoryNode) {
            rows[recipe.id].sampleFactoryNode = node;
          }

          // One row per consumed input
          for (const req of recipe.requires) {
            if (!rows[req.input.id]) {
              rows[req.input.id] = createScheduleRow(req.input);
            }
            rows[req.input.id].consumedPerMin += req.amountPerCycle * cyclesPerMin;
          }
        }
      }
    }

    return Object.values(rows);
  });

  onAddMissingFactories(row: ScheduleRow) {
    // TODO: implement add-missing-factories logic
  }

  onAddFactory(row: ScheduleRow) {
    this.optimizationService.loadUniverse().then(universe => {
      if (row.sampleFactoryNode) {
        this.userSession.duplicateNode(row.sampleFactoryNode, 40, 40);
      } else {
        const resourceObj = universe.resources[row.resource];
        this.userSession.addNewFactory(resourceObj.createdIn, resourceObj)
      }

    });
  }

  onRemoveFactory(row: ScheduleRow) {
    if (!row.sampleFactoryNode || row.nbFactories === 0) return;
    this.userSession.removeNode(row.sampleFactoryNode);
  }

  onAddResourceTarget() {
    this.optimizationService.loadUniverse().then(universe => {
      const items = Object.keys(universe.resources);

      const dialogRef = this.dialog.open<ItemSelectDialog, ItemSelectDialogData, ItemSelectDialogResult>(
        ItemSelectDialog,
        {
          data: { title: 'Select a resource target', items },
          width: '420px',
          height: '65vh',
          maxWidth: '95vw',
          maxHeight: '90vh',
        },

      );

      dialogRef.afterClosed().subscribe(selected => {
        if (selected) {
          const resourceObject = universe.resources[selected.label];
          this.userSession.addNewFactory(resourceObject.createdIn, resourceObject);
        }
      });
    });

  }
}
