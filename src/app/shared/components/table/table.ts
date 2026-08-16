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
  /** Строка кликабельна целиком — курсор и переход по Enter. */
  readonly clickable = input(false);

  readonly rowClick = output<T>();

  protected readonly columns = contentChildren(TableColumn);

  /** Подвал рисуем, только если хоть одна колонка его описала. */
  protected readonly hasFooter = computed(() =>
    this.columns().some((column) => column.footer() || column.footerTemplate()),
  );

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
