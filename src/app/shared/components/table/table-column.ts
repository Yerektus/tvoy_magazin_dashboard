import { Directive, TemplateRef, inject, input } from '@angular/core';

/**
 * Колонка таблицы. Вешается на `<ng-template>`, строка приходит в контекст:
 * `<ng-template appTableColumn="sender" header="Отправитель" let-row>`.
 */
@Directive({ selector: '[appTableColumn]' })
export class TableColumn {
  readonly key = input.required<string>({ alias: 'appTableColumn' });
  /** Текст в шапке. Если нужна разметка — передайте `headerTemplate`. */
  readonly header = input('');
  readonly headerTemplate = input<TemplateRef<unknown> | null>(null);
  /** Текст в подвале — например итог по колонке. Разметка — через `footerTemplate`. */
  readonly footer = input('');
  readonly footerTemplate = input<TemplateRef<unknown> | null>(null);
  readonly align = input<'left' | 'right'>('left');
  /** Дополнительные классы для колонки, например ширина: `w-10`. */
  readonly width = input('');

  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}
