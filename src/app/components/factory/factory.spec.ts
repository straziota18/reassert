import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Factory } from './factory';

describe('Factory', () => {
  let component: Factory;
  let fixture: ComponentFixture<Factory>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Factory],
    }).compileComponents();

    fixture = TestBed.createComponent(Factory);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
