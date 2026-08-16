import { Component, input } from '@angular/core';
import { LoaderCircle } from 'lucide';

import { Icon } from '../icon/icon';

/** Крутящийся индикатор загрузки: `<app-spinner [size]="24" />`. */
@Component({
  selector: 'app-spinner',
  imports: [Icon],
  template: `
    <app-icon
      class="animate-spin motion-reduce:animate-none"
      [icon]="spinnerIcon"
      [size]="size()"
    />
  `,
  host: { class: 'inline-flex', role: 'status', 'aria-label': 'Загрузка' },
})
export class Spinner {
  readonly size = input(16);

  protected readonly spinnerIcon = LoaderCircle;
}
