import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { Button } from '../../../../shared/components/button/button';
import { Checkbox } from '../../../../shared/components/checkbox/checkbox';
import { Modal } from '../../../../shared/components/modal/modal';
import {
  Select,
  type SelectOption,
  type SelectValue,
} from '../../../../shared/components/select/select';
import { TextField } from '../../../../shared/components/text-field/text-field';
import { Toasts } from '../../../../shared/services/toasts';
import { type PurchasePlan } from '../../models/plan';
import { Planning } from '../../services/planning';

/** На сколько дней закупаемся — те же сроки, что были в настройках расчёта. */
const HORIZONS: SelectOption[] = [
  { value: 3, label: 'Закуп на 3 дня' },
  { value: 7, label: 'Закуп на неделю' },
  { value: 14, label: 'Закуп на 2 недели' },
  { value: 30, label: 'Закуп на месяц' },
];

/**
 * Новая планировка: имя, горизонт и учёт склада. Период продаж берём обычный —
 * месяц, его можно сменить уже на странице расчёта.
 */
@Component({
  selector: 'app-create-plan-dialog',
  imports: [ReactiveFormsModule, Modal, TextField, Select, Button, Checkbox],
  templateUrl: './create-plan-dialog.html',
})
export class CreatePlanDialog {
  readonly open = input(false);
  readonly closed = output<void>();
  readonly created = output<PurchasePlan>();

  protected readonly horizons = HORIZONS;
  protected readonly horizon = signal(14);
  protected readonly useStock = signal(true);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
  });

  protected readonly sending = signal(false);

  private readonly planning = inject(Planning);
  private readonly toasts = inject(Toasts);

  constructor() {
    effect(() => {
      if (!this.open()) {
        this.form.reset({ name: '' });
        this.horizon.set(14);
        this.useStock.set(true);
      }
    });
  }

  protected setHorizon(value: SelectValue): void {
    this.horizon.set(Number(value));
  }

  protected cancel(): void {
    if (this.sending()) {
      return;
    }

    this.closed.emit();
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.sending()) {
      this.form.controls.name.markAsTouched();
      return;
    }

    this.sending.set(true);

    try {
      const plan = await this.planning.rebuild(
        30,
        this.horizon(),
        this.form.controls.name.value.trim(),
        this.useStock(),
      );
      this.created.emit(plan);
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось создать планировку');
    } finally {
      this.sending.set(false);
    }
  }
}
