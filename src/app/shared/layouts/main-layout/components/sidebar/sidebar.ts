import { Component, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LogOut } from 'lucide';

import { Avatar } from '../../../../components/avatar/avatar';
import { Icon } from '../../../../components/icon/icon';
import { Menu, MenuTrigger } from '../../../../components/menu/menu';
import { MenuItem } from '../../../../components/menu/menu-item';

export interface SidebarItem {
  label: string;
  /** `null` — пункт есть в навигации, но страница ещё не сделана. */
  route: string | null;
}

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, Avatar, Icon, Menu, MenuItem, MenuTrigger],
  templateUrl: './sidebar.html',
  host: {
    // До lg сайдбар выезжает поверх страницы: на телефоне отдавать ему
    // четверть ширины бессмысленно. С lg — обычная колонка, как было.
    class:
      'fixed inset-y-0 left-0 z-40 w-56 overflow-hidden bg-neutral-100 transition-transform duration-200 ease-in-out lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:shrink-0 lg:transition-[width] motion-reduce:transition-none',
    '[class.translate-x-0]': 'open()',
    '[class.-translate-x-full]': '!open()',
    '[class.lg:w-56]': 'open()',
    '[class.lg:w-0]': '!open()',
    '[class.lg:translate-x-0]': 'true',
  },
})
export class Sidebar {
  readonly items = input.required<readonly SidebarItem[]>();
  /** Открыт ли сайдбар. Ширина съезжает к нулю, содержимое обрезается. */
  readonly open = input(true);
  /** Перешли по пункту меню — на телефоне шторку пора закрыть. */
  readonly navigated = output<void>();
  /** Почта пользователя — подпись под аватаркой внизу меню. */
  readonly user = input('');
  readonly logout = output<void>();

  protected readonly logoutIcon = LogOut;
}
