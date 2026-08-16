import { Component } from '@angular/core';

/**
 * Панель над содержимым страницы: слева обычное содержимое, справа — действия.
 *
 * ```html
 * <app-toolbar>
 *   <p>Всего: 12</p>
 *   <div toolbarActions><app-button>Добавить</app-button></div>
 * </app-toolbar>
 * ```
 */
@Component({
  selector: 'app-toolbar',
  templateUrl: './toolbar.html',
  host: { class: 'block' },
})
export class Toolbar {}
