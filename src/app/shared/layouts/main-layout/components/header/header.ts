import { Component, computed, inject, input, output } from '@angular/core';
import { PanelLeftClose, PanelLeftOpen } from 'lucide';

import { Breadcrumbs } from '../../../../components/breadcrumbs/breadcrumbs';
import { Button } from '../../../../components/button/button';
import { Icon } from '../../../../components/icon/icon';
import { Tabs } from '../../../../components/tabs/tabs';
import { PageHeader } from '../../../../services/page-header';

@Component({
  selector: 'app-header',
  imports: [Button, Icon, Tabs, Breadcrumbs],
  templateUrl: './header.html',
  // z-20: содержимое страницы поднимает свои слои до z-10 — например, кружки
  // шагов в истории накладной, — и на прокрутке лезло поверх шапки.
  host: { class: 'sticky top-0 z-20 block border-b border-neutral-200 bg-white' },
})
export class Header {
  /** Название открытой страницы. Показывается, если страница не задала крошки. */
  readonly title = input('');
  /** Открыт ли сайдбар — от этого зависит иконка кнопки. */
  readonly sidebarOpen = input(true);
  readonly toggleSidebar = output<void>();

  /** Крошки и табы объявляет открытая страница. */
  protected readonly page = inject(PageHeader);

  protected readonly menuIcon = computed(() =>
    this.sidebarOpen() ? PanelLeftClose : PanelLeftOpen,
  );
  protected readonly menuLabel = computed(() =>
    this.sidebarOpen() ? 'Скрыть меню' : 'Показать меню',
  );
}
