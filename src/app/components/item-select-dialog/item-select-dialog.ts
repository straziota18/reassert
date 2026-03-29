import { AfterViewInit, Component, computed, effect, ElementRef, inject, QueryList, signal, ViewChildren } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';

export interface ItemSelectDialogData {
  /** Dialog title / prompt shown at the top. */
  title: string;
  /** Flat list of string items the user can pick from. */
  items: string[];
}

@Component({
  selector: 'app-item-select-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
  ],
  templateUrl: './item-select-dialog.html',
  styleUrl: './item-select-dialog.scss',
})
export class ItemSelectDialog implements AfterViewInit {
  private readonly dialogRef = inject<MatDialogRef<ItemSelectDialog, string>>(MatDialogRef);
  private readonly el = inject(ElementRef<HTMLElement>);
  readonly data = inject<ItemSelectDialogData>(MAT_DIALOG_DATA);

  @ViewChildren('itemEl') itemElements!: QueryList<ElementRef<HTMLElement>>;

  readonly query = signal('');
  readonly highlightedIndex = signal(0);

  readonly filteredItems = computed(() => {
    const q = this.query().trim().toLowerCase();
    const filteredItems = q
      ? this.data.items.filter(item => item.toLowerCase().includes(q))
      : this.data.items;
    return filteredItems.sort((a, b) => a.localeCompare(b));
  });

  constructor() {
    // Reset highlight to top whenever the filter changes.
    effect(() => {
      this.query();
      this.highlightedIndex.set(0);
    });
  }

  ngAfterViewInit(): void {
    // Capture the dialog's rendered size and lock it so that filtering items
    // (which changes the list height) cannot cause the panel to resize.
    const surface = (
      this.el.nativeElement.closest('.mat-mdc-dialog-surface') as HTMLElement | null
    ) ?? this.el.nativeElement.parentElement!;
    const { width, height } = surface.getBoundingClientRect();
    this.dialogRef.updateSize(`${Math.round(width)}px`, `${Math.round(height)}px`);
  }

  onKeydown(event: KeyboardEvent): void {
    const items = this.filteredItems();
    if (items.length === 0) return;

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const next = (this.highlightedIndex() + 1) % items.length;
        this.highlightedIndex.set(next);
        this.scrollToHighlighted(next);
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const prev = (this.highlightedIndex() - 1 + items.length) % items.length;
        this.highlightedIndex.set(prev);
        this.scrollToHighlighted(prev);
        break;
      }
      case 'Enter': {
        event.preventDefault();
        const idx = this.highlightedIndex();
        if (idx >= 0 && idx < items.length) {
          this.select(items[idx]);
        }
        break;
      }
    }
  }

  private scrollToHighlighted(index: number): void {
    this.itemElements.get(index)?.nativeElement?.scrollIntoView({ block: 'nearest' });
  }

  select(item: string): void {
    this.dialogRef.close(item);
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
