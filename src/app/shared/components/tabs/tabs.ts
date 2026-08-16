import { Component, input, output } from '@angular/core';

/**
 * Полоска табов: `<app-tabs [items]="…" [active]="…" (selected)="…" />`.
 * Содержимое рисует тот, кто владеет состоянием.
 */
@Component({
  selector: 'app-tabs',
  templateUrl: './tabs.html',
  host: { class: 'block' },
})
export class Tabs {
  readonly items = input.required<readonly string[]>();
  readonly active = input<string | null>(null);
  /** Число рядом с названием вкладки. Ноль не показываем. */
  readonly badges = input<Record<string, number>>({});
  readonly selected = output<string>();
}
