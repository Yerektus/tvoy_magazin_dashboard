import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Check, ChevronDown } from 'lucide';

import { Icon } from '../icon/icon';

/** Высота списка (`max-h-64`) с отступом: столько места ему нужно снизу. */
const PANEL_HEIGHT = 264;

/** Значение пункта: идентификатор из базы или строковый код. */
export type SelectValue = string | number;

export interface SelectOption {
  value: SelectValue;
  label: string;
}

/**
 * Выбор из списка — нарисованный, а не системный:
 *
 * ```html
 * <app-select
 *   class="w-56"
 *   [options]="stores()"
 *   [value]="storeId()"
 *   placeholder="Выберите магазин"
 *   (selected)="choose($event)"
 * />
 * ```
 *
 * Список раскрывается под кнопкой обычным `absolute`, так что внутри
 * контейнера с `overflow: hidden` его обрежет — там нужен `app-menu`.
 */
@Component({
  selector: 'app-select',
  imports: [Icon],
  templateUrl: './select.html',
  host: {
    class: 'relative block',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'close()',
  },
})
export class Select {
  readonly options = input.required<readonly SelectOption[]>();
  readonly value = input<SelectValue | null>(null);
  /** Надпись, пока ничего не выбрано. */
  readonly placeholder = input('');
  readonly disabled = input(false);
  readonly ariaLabel = input('');
  readonly selected = output<SelectValue>();

  protected readonly open = signal(false);
  /** Список раскрылся вверх: снизу не помещался. */
  protected readonly up = signal(false);

  protected readonly chevronIcon = ChevronDown;
  protected readonly checkIcon = Check;

  protected readonly current = computed(
    () => this.options().find((option) => option.value === this.value()) ?? null,
  );

  protected readonly label = computed(() => this.current()?.label ?? this.placeholder());

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // Запрос ушёл, кнопка заблокировалась — открытый список закрываем.
    effect(() => {
      if (this.disabled()) {
        this.open.set(false);
      }
    });
  }

  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }

    // В сайдбаре телефона выбор стоит у самого низа экрана — список туда
    // просто не влезает, и половина магазинов оказывается за краем.
    const trigger = this.host.nativeElement.getBoundingClientRect();
    const below = window.innerHeight - trigger.bottom;

    this.up.set(below < PANEL_HEIGHT && trigger.top > below);
    this.open.set(true);
  }

  protected choose(option: SelectOption): void {
    this.close();

    if (option.value !== this.value()) {
      this.selected.emit(option.value);
    }
  }

  /** Клик мимо закрывает список — и при этом доходит до того, куда нажали. */
  protected onDocumentPointerDown(event: Event): void {
    const target = event.target as Node | null;

    if (this.open() && target && !this.host.nativeElement.contains(target)) {
      this.close();
    }
  }

  protected close(): void {
    this.open.set(false);
  }
}
