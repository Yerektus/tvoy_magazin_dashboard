import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output } from '@angular/core';
import { PanelLeftClose, PanelLeftOpen } from 'lucide';

import { Assistant } from '../../../../../features/assistant/services/assistant';
import { Auth } from '../../../../../features/auth/services/auth';
import { Breadcrumbs } from '../../../../components/breadcrumbs/breadcrumbs';
import { Button } from '../../../../components/button/button';
import { Icon } from '../../../../components/icon/icon';
import { Tabs } from '../../../../components/tabs/tabs';
import { PageHeader } from '../../../../services/page-header';

@Component({
  selector: 'app-header',
  imports: [Button, Icon, Tabs, Breadcrumbs, NgTemplateOutlet],
  templateUrl: './header.html',
  // z-20: содержимое страницы поднимает свои слои до z-10 — например, кружки
  // шагов в истории накладной, — и на прокрутке лезло поверх шапки.
  host: {
    class: 'sticky top-0 z-20 block shrink-0 border-b border-neutral-200 bg-white',
  },
})
export class Header {
  /** Название открытой страницы. Показывается, если страница не задала крошки. */
  readonly title = input('');
  /** Открыт ли сайдбар — от этого зависит иконка кнопки. */
  readonly sidebarOpen = input(true);
  readonly toggleSidebar = output<void>();

  /** Крошки, табы и действия справа объявляет открытая страница. */
  protected readonly page = inject(PageHeader);
  private readonly auth = inject(Auth);
  protected readonly assistant = inject(Assistant);

  /** Помощник только тем, кому сервер его открыл. */
  protected readonly canChat = computed(() => this.auth.usesAssistant());

  protected readonly menuIcon = computed(() =>
    this.sidebarOpen() ? PanelLeftClose : PanelLeftOpen,
  );
  protected readonly menuLabel = computed(() =>
    this.sidebarOpen() ? 'Скрыть меню' : 'Показать меню',
  );
}
