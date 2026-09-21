import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { type IconNode, LogOut } from 'lucide';

import { Avatar } from '../../../../components/avatar/avatar';
import { Icon } from '../../../../components/icon/icon';
import { Menu, MenuTrigger } from '../../../../components/menu/menu';
import { MenuItem } from '../../../../components/menu/menu-item';
import { Spinner } from '../../../../components/spinner/spinner';

export interface SidebarItem {
  label: string;
  icon: IconNode;
  /** `null` — пункт есть в навигации, но страница ещё не сделана. */
  route: string | null;
}

const WIDTH_KEY = 'sidebar-width';
const DEFAULT_WIDTH = 224;
const MIN_WIDTH = 200;

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, Avatar, Icon, Menu, MenuItem, MenuTrigger, Spinner],
  templateUrl: './sidebar.html',
  host: {
    // До lg сайдбар выезжает поверх страницы: на телефоне отдавать ему
    // четверть ширины бессмысленно. С lg — обычная колонка, ширину тянут
    // за правый край.
    class:
      'fixed inset-y-0 left-0 z-40 w-56 overflow-hidden bg-neutral-100 transition-transform duration-200 ease-in-out lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:shrink-0 lg:transition-[width] motion-reduce:transition-none',
    '[class.translate-x-0]': 'open()',
    '[class.-translate-x-full]': '!open()',
    '[class.lg:translate-x-0]': 'true',
    '[class.lg:!transition-none]': 'dragging()',
    '[style.width]': 'hostWidth()',
    '(window:resize)': 'clampToWindow()',
  },
})
export class Sidebar {
  private readonly destroyRef = inject(DestroyRef);

  readonly items = input.required<readonly SidebarItem[]>();
  /** Пока спрашиваем расширения — вместо пунктов меню крутится спиннер. */
  readonly loading = input(false);
  /** Открыт ли сайдбар. Ширина съезжает к нулю, содержимое обрезается. */
  readonly open = input(true);
  /** Перешли по пункту меню — на телефоне шторку пора закрыть. */
  readonly navigated = output<void>();
  /** Почта пользователя — подпись под аватаркой внизу меню. */
  readonly user = input('');
  readonly logout = output<void>();

  protected readonly logoutIcon = LogOut;
  protected readonly dragging = signal(false);
  protected readonly width = signal(readWidth());

  private readonly desktop = signal(isDesktop());
  private dragStartX = 0;
  private dragStartWidth = DEFAULT_WIDTH;

  /**
   * На телефоне ширину не задаём пикселями: панель `fixed` и `w-56`, иначе
   * сохранённые 360px со компьютера выталкивают страницу. На большом экране
   * закрытая панель схлопывается в ноль, открытая — выбранной ширины.
   */
  protected readonly hostWidth = computed(() => {
    if (!this.desktop()) {
      return null;
    }

    return `${this.open() ? this.width() : 0}px`;
  });

  constructor() {
    const media = window.matchMedia('(min-width: 1024px)');
    const onMedia = () => this.desktop.set(media.matches);
    media.addEventListener('change', onMedia);
    this.destroyRef.onDestroy(() => {
      media.removeEventListener('change', onMedia);
      this.clearDragCursor();
    });
  }

  protected startResize(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.dragging.set(true);
    this.dragStartX = event.clientX;
    this.dragStartWidth = this.width();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  protected onResize(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }

    // Правый край: тянем вправо — меню шире.
    this.width.set(clampWidth(this.dragStartWidth + (event.clientX - this.dragStartX)));
  }

  protected endResize(): void {
    if (!this.dragging()) {
      return;
    }

    this.dragging.set(false);
    this.clearDragCursor();
    writeWidth(this.width());
  }

  protected resetWidth(): void {
    this.width.set(DEFAULT_WIDTH);
    writeWidth(DEFAULT_WIDTH);
  }

  protected clampToWindow(): void {
    const next = clampWidth(this.width());

    if (next === this.width()) {
      return;
    }

    this.width.set(next);
    writeWidth(next);
  }

  private clearDragCursor(): void {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
}

function isDesktop(): boolean {
  return window.matchMedia('(min-width: 1024px)').matches;
}

function maxWidth(): number {
  return Math.max(MIN_WIDTH, Math.min(400, window.innerWidth - 480));
}

function clampWidth(value: number): number {
  return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(value)));
}

function readWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY));

  if (!Number.isFinite(raw)) {
    return DEFAULT_WIDTH;
  }

  return clampWidth(raw);
}

function writeWidth(value: number): void {
  localStorage.setItem(WIDTH_KEY, String(value));
}
