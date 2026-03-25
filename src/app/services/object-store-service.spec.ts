import { TestBed } from '@angular/core/testing';

import { ObjectStoreService } from './object-store-service';

describe('ObjectStoreService', () => {
  let service: ObjectStoreService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ObjectStoreService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
