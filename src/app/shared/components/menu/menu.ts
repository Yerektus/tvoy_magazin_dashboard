import {
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  Injector,
  afterNextRender,
  booleanAttribute,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Ellipsis } from 'lucide';

import { Button } from '../button/button';
import { Icon } from '../icon/icon';

/** Ширина панели по умолчанию: узкий список действий у кнопки «…». */
const WIDTH = 176;
const GAP = 4;
const EDGE = 8;

/**
 * Меню действий за кнопкой «…»:
 *
 * ```html
 * <app-menu ariaLabel="Действия">
 *   <button appMenuItem (click)="remove()">Удалить</button>
 * </app-menu>
 * ```
 */
@Component({
  selector: 'app-menu',
  imports: [Button, Icon],
  templateUrl: './menu.html',
  host: {
    class: 'inline-flex',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'close()',
    '(window:resize)': 'close()',
  },
})
export class Menu {
  readonly ariaLabel = input('Действия');
  /** Кнопку рисует вызывающий — например, строкой профиля в сайдбаре. */
  readonly customTrigger = input(false, { transform: booleanAttribute });
  /** Панель во всю ширину кнопки, а не узким списком сбоку. */
  readonly fullWidth = input(false, { transform: booleanAttribute });

  protected readonly menuIcon = Ellipsis;
  protected readonly open = signal(false);

  /** Открыт ли список: нужно своей кнопке для `aria-expanded`. */
  readonly expanded = this.open.asReadonly();
  /** Панель позиционируется fixed — иначе её обрезал бы скроллящийся контейнер таблицы. */
  protected readonly position = signal({ top: 0, left: 0, width: WIDTH });

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  // Меряем хост, а не кнопку: у `app-button` `display: contents`, своего бокса
  // у неё нет и getBoundingClientRect() вернул бы нули.
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  constructor() {
    // Панель висит на fixed-координатах, при прокрутке она бы «отклеилась»
    // от кнопки. Слушаем в фазе перехвата, чтобы ловить и внутренние скроллы.
    const onScroll = () => this.close();

    effect((onCleanup) => {
      if (!this.open()) {
        return;
      }

      document.addEventListener('scroll', onScroll, true);
      onCleanup(() => document.removeEventListener('scroll', onScroll, true));
    });

    inject(DestroyRef).onDestroy(() => document.removeEventListener('scroll', onScroll, true));
  }

  toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }

    const trigger = this.host.nativeElement.getBoundingClientRect();
    // Во всю ширину — панель встаёт ровно под кнопку, узкая — по её правому краю.
    const width = this.fullWidth() ? trigger.width : WIDTH;

    this.position.set({
      top: trigger.bottom + GAP,
      left: Math.max(EDGE, this.fullWidth() ? trigger.left : trigger.right - width),
      width,
    });
    this.open.set(true);

    // Высоту панели узнаём только после отрисовки: если снизу не помещается,
    // разворачиваем её вверх от кнопки.
    afterNextRender(
      () => {
        const panel = this.panel()?.nativeElement;
        if (!panel) {
          return;
        }

        const { height } = panel.getBoundingClientRect();
        if (trigger.bottom + GAP + height > window.innerHeight - EDGE) {
          this.position.update((current) => ({ ...current, top: trigger.top - GAP - height }));
        }
      },
      { injector: this.injector },
    );
  }

  /** Клик мимо меню закрывает его — и при этом доходит до того, куда нажали. */
  protected onDocumentPointerDown(event: Event): void {
    if (!this.open()) {
      return;
    }

    const target = event.target as Node | null;
    if (target && this.host.nativeElement.contains(target)) {
      return;
    }

    this.close();
  }

  protected close(): void {
    this.open.set(false);
  }
}

/**
 * Своя кнопка вместо «…»:
 *
 * ```html
 * <app-menu [customTrigger]="true">
 *   <button appMenuTrigger>Профиль</button>
 *   <button appMenuItem (click)="logout()">Выйти</button>
 * </app-menu>
 * ```
 */
@Directive({
  selector: '[appMenuTrigger]',
  host: {
    type: 'button',
    'aria-haspopup': 'menu',
    '[attr.aria-expanded]': 'menu.expanded()',
    '(click)': 'menu.toggle()',
  },
})
export class MenuTrigger {
  protected readonly menu = inject(Menu);
}
