import { Component, computed, inject, signal } from '@angular/core';
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
export class ItemSelectDialog {
  private readonly dialogRef = inject<MatDialogRef<ItemSelectDialog, string>>(MatDialogRef);
  readonly data = inject<ItemSelectDialogData>(MAT_DIALOG_DATA);

  readonly query = signal('');

  readonly filteredItems = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q
      ? this.data.items.filter(item => item.toLowerCase().includes(q))
      : this.data.items;
  });

  select(item: string): void {
    this.dialogRef.close(item);
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
