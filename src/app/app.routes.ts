import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '',         redirectTo: 'factory', pathMatch: 'full' },
  { path: 'factory',  loadComponent: () => import('./components/factory/factory').then(m => m.Factory) },
  { path: 'schedule', loadComponent: () => import('./components/schedule/schedule').then(m => m.Schedule) },
];