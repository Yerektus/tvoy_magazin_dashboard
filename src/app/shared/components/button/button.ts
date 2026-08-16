import { Component, computed, input } from '@angular/core';

import { Spinner } from '../spinner/spinner';

export type ButtonType = 'button' | 'submit' | 'reset';
export type ButtonVariant = 'default' | 'primary' | 'outline' | 'ghost';

const BASE =
  'rounded-sm text-sm font-medium whitespace-nowrap transition cursor-pointer focus:ring-0 focus:outline-none disabled:opacity-60';

const VARIANTS: Record<ButtonVariant, string> = {
  default: 'border border-neutral-200 shadow-md/5 hover:bg-neutral-100 focus:ring-slate-900/20',
  primary: 'bg-sky-500 text-white shadow-md/5 hover:bg-sky-600 focus:ring-sky-400/20',
  // То же действие, что и primary, но не спорит за внимание в списке карточек.
  outline: 'border border-sky-500 text-sky-600 hover:bg-sky-50 focus:ring-sky-400/20',
  ghost: 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus:ring-slate-900/20',
};

/** Квадратная кнопка под одну иконку — без горизонтальных полей. */
const ICON_SHAPE = 'inline-flex items-center justify-center p-1';
const TEXT_SHAPE = 'px-4 py-1.5';

/**
 * Кнопка: `<app-button type="submit" [fullWidth]="true">Войти</app-button>`.
 * Для кнопки-иконки: `<app-button variant="ghost" [icon]="true"><app-icon … /></app-button>`.
 * Текст и иконки передаются содержимым.
 */
@Component({
  selector: 'app-button',
  imports: [Spinner],
  templateUrl: './button.html',
  host: { class: 'contents' },
})
export class Button {
  readonly type = input<ButtonType>('button');
  readonly variant = input<ButtonVariant>('default');
  readonly fullWidth = input(false);
  readonly disabled = input(false);
  /** Запрос в процессе: вместо надписи крутится спиннер, кнопка заблокирована. */
  readonly loading = input(false);
  /** Внутри только иконка — тогда поля одинаковые со всех сторон. */
  readonly icon = input(false);
  readonly ariaLabel = input('');
  readonly ariaExpanded = input<boolean | null>(null);

  protected readonly classes = computed(() =>
    [
      BASE,
      this.icon() ? ICON_SHAPE : TEXT_SHAPE,
      VARIANTS[this.variant()],
      this.fullWidth() ? 'w-full' : '',
    ]
      .join(' ')
      .trim(),
  );
}
