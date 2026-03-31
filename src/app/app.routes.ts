import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '',                  redirectTo: 'welcome', pathMatch: 'full' },
  { path: 'factory-layout',    loadComponent: () => import('./components/factory/factory').then(m => m.Factory) },
  { path: 'factory-inventory', loadComponent: () => import('./components/factory-inventory/factory-inventory').then(m => m.FactoryInventory) },
  { path: 'schedule',          loadComponent: () => import('./components/schedule/schedule').then(m => m.Schedule) },
  { path: 'welcome',           loadComponent: () => import('./components/welcome/welcome').then(m => m.Welcome) },
  { path: '**',                redirectTo: 'welcome' },
];