import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface EnterNameDialogData {
  /** Dialog title, e.g. "Save as", "New layout". */
  title: string;
  /** Optional placeholder / hint for the name field. */
  placeholder?: string;
  /** Pre-filled value. */
  initialValue?: string;
}

@Component({
  selector: 'app-enter-name-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './enter-name-dialog.html',
  styleUrl: './enter-name-dialog.scss',
})
export class EnterNameDialog {
  private readonly dialogRef = inject<MatDialogRef<EnterNameDialog, string | null>>(MatDialogRef);
  readonly data = inject<EnterNameDialogData>(MAT_DIALOG_DATA);

  readonly name = signal(this.data.initialValue ?? '');

  confirm(): void {
    const trimmed = this.name().trim();
    if (!trimmed) return;
    this.dialogRef.close(trimmed);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}
