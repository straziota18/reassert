import { AfterViewInit, Component, computed, effect, ElementRef, inject, QueryList, signal, ViewChildren } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';

export interface ItemSelectDialogItem {
  label: string;
  /** If present and non-empty, selecting this item opens a second step to pick a sub-item. */
  subItems?: string[];
}

export interface ItemSelectDialogResult {
  label: string;
  subItem: string | null;
}

export interface ItemSelectDialogData {
  /** Dialog title shown in step 1. */
  title: string;
  /** Title shown in step 2. Defaults to 'Select a variant'. */
  subTitle?: string;
  /** Items to pick from. Plain strings are treated as items with no sub-items. */
  items: (string | ItemSelectDialogItem)[];
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
  private readonly dialogRef = inject<MatDialogRef<ItemSelectDialog, ItemSelectDialogResult>>(MatDialogRef);
  private readonly el = inject(ElementRef<HTMLElement>);
  readonly data = inject<ItemSelectDialogData>(MAT_DIALOG_DATA);

  @ViewChildren('itemEl') itemElements!: QueryList<ElementRef<HTMLElement>>;

  readonly query = signal('');
  readonly highlightedIndex = signal(0);
  readonly step = signal<'main' | 'sub'>('main');
  readonly selectedItem = signal<ItemSelectDialogItem | null>(null);

  /** Normalize all items to `ItemSelectDialogItem` once at construction time. */
  private readonly normalizedItems: ItemSelectDialogItem[] = this.data.items.map(i =>
    typeof i === 'string' ? { label: i } : i
  );

  readonly filteredItems = computed(() => {
    const q = this.query().trim().toLowerCase();
    const items = q
      ? this.normalizedItems.filter(item => item.label.toLowerCase().includes(q))
      : this.normalizedItems;
    return [...items].sort((a, b) => a.label.localeCompare(b.label));
  });

  readonly filteredSubItems = computed(() => {
    const q = this.query().trim().toLowerCase();
    const subs = this.selectedItem()?.subItems ?? [];
    return q ? subs.filter(s => s.toLowerCase().includes(q)) : subs;
  });

  constructor() {
    // Reset highlight to top whenever the filter or step changes.
    effect(() => {
      this.query();
      this.step();
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
    const items = this.step() === 'main'
      ? this.filteredItems()
      : this.filteredSubItems();
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
        if (this.step() === 'main') {
          const item = this.filteredItems()[idx];
          if (item) this.select(item);
        } else {
          const sub = this.filteredSubItems()[idx];
          if (sub !== undefined) this.selectSub(sub);
        }
        break;
      }
    }
  }

  private scrollToHighlighted(index: number): void {
    this.itemElements.get(index)?.nativeElement?.scrollIntoView({ block: 'nearest' });
  }

  select(item: ItemSelectDialogItem): void {
    if (item.subItems?.length) {
      this.selectedItem.set(item);
      this.query.set('');
      this.step.set('sub');
    } else {
      this.dialogRef.close({ label: item.label, subItem: null });
    }
  }

  selectSub(subItem: string): void {
    this.dialogRef.close({ label: this.selectedItem()!.label, subItem });
  }

  back(): void {
    this.step.set('main');
    this.query.set('');
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
