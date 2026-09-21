import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, contentChildren, input, output } from '@angular/core';

import { Spinner } from '../spinner/spinner';
import { TableColumn } from './table-column';

/**
 * Таблица со строками произвольного типа. Колонки описываются шаблонами:
 *
 * ```html
 * <app-table [rows]="documents()" [trackKey]="trackById">
 *   <ng-template appTableColumn="sender" header="Отправитель" let-row>
 *     {{ row.sender }}
 *   </ng-template>
 * </app-table>
 * ```
 *
 * Крайние колонки без бокового отступа: шапка сходится с подписью «Всего»
 * над таблицей, между колонками зазор остаётся.
 */
@Component({
  selector: 'app-table',
  imports: [NgTemplateOutlet, Spinner],
  templateUrl: './table.html',
})
export class Table<T> {
  readonly rows = input.required<readonly T[]>();
  /** Чем различать строки; по умолчанию — порядковый номер. */
  readonly trackKey = input<((row: T) => unknown) | null>(null);
  readonly empty = input('Пока пусто');
  /** Данные ещё едут: вместо текста пустого состояния крутится спиннер. */
  readonly loading = input(false);
  /** Минимальная ширина, например `min-w-3xl`: на узком экране таблица прокрутится. */
  readonly minWidth = input('');
  /** Ограничивает высоту: тело таблицы прокручивается, шапка остаётся на месте. */
  readonly maxHeight = input('');
  /** Строка кликабельна целиком — курсор и переход по Enter. */
  readonly clickable = input(false);

  readonly rowClick = output<T>();

  protected readonly columns = contentChildren(TableColumn);

  /** Подвал рисуем, только если хоть одна колонка его описала. */
  protected readonly hasFooter = computed(() =>
    this.columns().some((column) => column.footer() || column.footerTemplate()),
  );

  /** Вторая строка шапки — фильтры по колонкам. */
  protected readonly hasFilters = computed(() =>
    this.columns().some((column) => column.filterTemplate()),
  );

  /** Пустой список не схлопывает таблицу, если задана высота. */
  protected readonly fillEmpty = computed(() => !!this.maxHeight() && this.rows().length === 0);

  protected readonly shellClass = computed(() => {
    const box = this.maxHeight();
    if (!box) {
      return 'overflow-x-auto';
    }

    return this.fillEmpty()
      ? `${box} flex flex-col overflow-x-auto overflow-y-hidden`
      : `${box} overflow-auto`;
  });

  protected key(row: T, index: number): unknown {
    return this.trackKey()?.(row) ?? index;
  }

  /** Клик по строке, кроме кликов по её кнопкам, ссылкам и галочкам. */
  protected onRowClick(event: Event, row: T): void {
    if (!this.clickable()) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('a, button, input, label')) {
      return;
    }

    this.rowClick.emit(row);
  }
}
