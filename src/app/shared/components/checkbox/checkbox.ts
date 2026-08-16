import { Component, input, output } from '@angular/core';
import { Check, Minus } from 'lucide';

import { Icon } from '../icon/icon';

/**
 * Чекбокс: нативный `<input>` для семантики и доступности,
 * галочка — иконка Lucide поверх него.
 */
@Component({
  selector: 'app-checkbox',
  imports: [Icon],
  templateUrl: './checkbox.html',
  host: { class: 'inline-flex' },
})
export class Checkbox {
  readonly checked = input(false);
  readonly indeterminate = input(false);
  readonly ariaLabel = input('');
  readonly disabled = input(false);
  readonly toggled = output<boolean>();

  protected readonly checkIcon = Check;
  protected readonly minusIcon = Minus;

  protected onChange(event: Event): void {
    this.toggled.emit((event.target as HTMLInputElement).checked);
  }
}
