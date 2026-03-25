import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ActiveFactory, VirtualFactory } from '../../services/model';
import { UserSessionService } from '../../services/user-session-service';

export interface ScheduleRow {
  factoryType: 'active' | 'virtual';
  factoryId: string;
  resource: string;
  producedPerMin: number;
  consumedPerMin: number;
}

@Component({
  selector: 'app-schedule',
  imports: [
    CommonModule,
    MatTableModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './schedule.html',
  styleUrl: './schedule.scss',
})
export class Schedule {
  private readonly userSession = inject(UserSessionService);

  readonly displayedColumns = ['type', 'factoryId', 'resource', 'producedPerMin', 'consumedPerMin'];

  readonly rows = computed<ScheduleRow[]>(() => {
    const layout = this.userSession.activeLayout();
    if (!layout) return [];

    const rows: ScheduleRow[] = [];

    for (const node of layout.factories) {
      const factory = node.factory;

      if ('outputs' in factory) {
        // VirtualFactory – each declared output is a production row
        const vf = factory as VirtualFactory;
        for (const output of vf.outputs) {
          rows.push({
            factoryType: 'virtual',
            factoryId: vf.id,
            resource: output.resource.id,
            producedPerMin: output.amountPerMinute,
            consumedPerMin: 0,
          });
        }
      } else {
        // ActiveFactory – derive rates from the active recipe's production cycle
        const af = factory as ActiveFactory;
        const recipe = af.activeRecipe();

        if (recipe) {
          const cyclesPerMin = 60 / recipe.productionCycle.seconds;

          // One row for the produced resource
          rows.push({
            factoryType: 'active',
            factoryId: af.id,
            resource: recipe.id,
            producedPerMin: recipe.productionCycle.nbUnits * cyclesPerMin,
            consumedPerMin: 0,
          });

          // One row per consumed input
          for (const req of recipe.requires) {
            rows.push({
              factoryType: 'active',
              factoryId: af.id,
              resource: req.input.id,
              producedPerMin: 0,
              consumedPerMin: req.amountPerCycle * cyclesPerMin,
            });
          }
        } else {
          // Factory has no recipe selected – still display it
          rows.push({
            factoryType: 'active',
            factoryId: af.id,
            resource: '(no recipe)',
            producedPerMin: 0,
            consumedPerMin: 0,
          });
        }
      }
    }

    return rows;
  });

  onAddResourceTarget(): void {
    // TODO: open "Add Resource Target" dialog
  }
}
