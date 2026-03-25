import { inject, Injectable } from '@angular/core';
import { ObjectStoreService } from './object-store-service';
import { OptimizationService } from './optimization-service';

@Injectable({
  providedIn: 'root',
})
export class UserSessionService {
  private readonly optimizationService = inject(OptimizationService);
  private readonly objectStoreService = inject(ObjectStoreService);
}
