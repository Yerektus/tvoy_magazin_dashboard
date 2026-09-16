import { Component, computed, input } from '@angular/core';

import { Spinner } from '../spinner/spinner';

export type ButtonType = 'button' | 'submit' | 'reset';
export type ButtonVariant = 'default' | 'secondary' | 'primary' | 'outline' | 'ghost';
export type ButtonSize = 'md' | 'lg';

const BASE =
  'rounded-sm text-sm font-medium whitespace-nowrap transition cursor-pointer focus:ring-0 focus:outline-none disabled:opacity-60';

const VARIANTS: Record<ButtonVariant, string> = {
  default: 'border border-neutral-200 shadow-md/5 hover:bg-neutral-100 focus:ring-slate-900/20',
  // Без рамки: серая заливка отделяет кнопку от белого фона.
  secondary: 'bg-stone-100 shadow-md/5 hover:bg-neutral-200 focus:ring-slate-900/20',
  primary: 'bg-blue-500 text-white shadow-md/5 hover:bg-blue-600 focus:ring-blue-400/20',
  // То же действие, что и primary, но не спорит за внимание в списке карточек.
  outline: 'border border-blue-500 text-blue-600 hover:bg-blue-50 focus:ring-blue-400/20',
  ghost: 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus:ring-slate-900/20',
};

/** Квадратная кнопка под одну иконку — без горизонтальных полей. */
const ICON_SHAPE: Record<ButtonSize, string> = {
  md: 'inline-flex size-8 items-center justify-center',
  lg: 'inline-flex size-10 items-center justify-center',
};
const TEXT_SHAPE = 'inline-flex h-8 items-center justify-center px-4';

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
  /** `lg` — крупнее нажимаемая область, иконка того же размера. */
  readonly size = input<ButtonSize>('md');
  readonly ariaLabel = input('');
  readonly ariaExpanded = input<boolean | null>(null);

  protected readonly classes = computed(() =>
    [
      BASE,
      this.icon() ? ICON_SHAPE[this.size()] : TEXT_SHAPE,
      VARIANTS[this.variant()],
      this.fullWidth() ? 'w-full' : '',
    ]
      .join(' ')
      .trim(),
  );
}
