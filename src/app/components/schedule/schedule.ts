import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ItemSelectDialog, ItemSelectDialogData } from '../item-select-dialog/item-select-dialog';
import { ActiveFactory, Resource, VirtualFactory } from '../../services/model';
import { OptimizationService } from '../../services/optimization-service';
import { UserSessionService } from '../../services/user-session-service';

export interface ScheduleRow {
  factoryId: string;
  resource: string;
  producedPerMin: number;
  consumedPerMin: number;
  nbFactories: number;
}

const createScheduleRow: (resource: Resource) => ScheduleRow = (resource: Resource) => {
  return {
    consumedPerMin: 0.0,
    producedPerMin: 0.0,
    factoryId: resource.createdIn.id,
    resource: resource.id,
    nbFactories: 0
  }
}

@Component({
  selector: 'app-schedule',
  imports: [
    CommonModule,
    MatDialogModule,
    MatTableModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './schedule.html',
  styleUrl: './schedule.scss',
})
export class Schedule {
  private readonly dialog = inject(MatDialog);
  private readonly optimizationService = inject(OptimizationService);
  private readonly userSession = inject(UserSessionService);

  readonly displayedColumns = [ 'factoryId', 'nbFactories', 'resource', 'producedPerMin', 'consumedPerMin'];

  readonly rows = computed<ScheduleRow[]>(() => {
    const layout = this.userSession.activeLayout();
    if (!layout) return [];

    const rows: { [resourceId: string]: ScheduleRow } = {};

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
      } else {
        // ActiveFactory – derive rates from the active recipe's production cycle
        const af = factory as ActiveFactory;
        const recipe = af.activeRecipe();

        if (recipe) {
          const cyclesPerMin = 60 / recipe.productionCycle.seconds;

          // One row for the produced resource
          if (!rows[recipe.id]) {
            rows[recipe.id] = createScheduleRow(recipe);
          }
          rows[recipe.id].producedPerMin += recipe.productionCycle.nbUnits * cyclesPerMin;
          rows[recipe.id].nbFactories += 1;

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

  onAddResourceTarget() {
    this.optimizationService.loadUniverse().then(universe => {
      const items = Object.keys(universe.resources);

      const dialogRef = this.dialog.open<ItemSelectDialog, ItemSelectDialogData, string>(
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
          const resourceObject = universe.resources[selected];
          this.userSession.addNewFactory(resourceObject.createdIn, resourceObject);
        }
      });
    });

  }
}
