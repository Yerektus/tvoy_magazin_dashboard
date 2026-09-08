import { Component, input } from '@angular/core';

/**
 * Пустой экран: страница открылась, а показывать на ней нечего. Карточка стоит
 * посреди области содержимого — кроме неё, на странице всё равно ничего нет.
 *
 * ```html
 * <app-empty title="Расширение не подключено">
 *   <app-icon emptyIcon [icon]="plugIcon" [size]="40" class="mb-3 text-neutral-400" />
 *   Подключите его на странице расширения.
 *   <a emptyAction routerLink="/settings/planning" class="mt-4 inline-block">Открыть →</a>
 * </app-empty>
 * ```
 */
@Component({
  selector: 'app-empty',
  templateUrl: './empty.html',
  host: { class: 'flex min-h-[70vh] items-center justify-center' },
})
export class Empty {
  /** Заголовок: чего именно нет. */
  readonly title = input.required<string>();
}
