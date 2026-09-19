import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Check, ChevronDown } from 'lucide';

import { Icon } from '../icon/icon';

const GAP = 4;
const EDGE = 8;

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
 * Несколько пунктов: `multiple` и `(selectedValues)`. Список не закрывается
 * по клику — можно отметить высокую и среднюю точность подряд.
 *
 * Панель висит на `fixed`-координатах — иначе её обрезал бы скролл таблицы.
 */
@Component({
  selector: 'app-select',
  imports: [Icon],
  templateUrl: './select.html',
  host: {
    class: 'relative block',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'close()',
    '(window:resize)': 'close()',
  },
})
export class Select {
  readonly options = input.required<readonly SelectOption[]>();
  readonly value = input<SelectValue | readonly SelectValue[] | null>(null);
  /** Надпись, пока ничего не выбрано. */
  readonly placeholder = input('');
  readonly disabled = input(false);
  readonly ariaLabel = input('');
  /** Высота как у фильтров таблицы: `h-8`, скругление как у инпута. */
  readonly compact = input(false, { transform: booleanAttribute });
  /** Несколько пунктов сразу: клик переключает, список остаётся открытым. */
  readonly multiple = input(false, { transform: booleanAttribute });
  readonly selected = output<SelectValue>();
  readonly selectedValues = output<SelectValue[]>();

  protected readonly open = signal(false);
  protected readonly position = signal({ top: 0, left: 0, width: 0 });

  protected readonly chevronIcon = ChevronDown;
  protected readonly checkIcon = Check;

  protected readonly selectedOptions = computed(() => {
    const options = this.options();

    if (this.multiple()) {
      const values = new Set(asValues(this.value()));
      return options.filter((option) => values.has(option.value));
    }

    const current = this.value();
    const found = options.find((option) => option.value === current);
    return found ? [found] : [];
  });

  protected readonly label = computed(() => {
    const selected = this.selectedOptions();
    return selected.length ? selected.map((option) => option.label).join(', ') : this.placeholder();
  });
  protected readonly empty = computed(() => this.selectedOptions().length === 0);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  constructor() {
    // Запрос ушёл, кнопка заблокировалась — открытый список закрываем.
    effect(() => {
      if (this.disabled()) {
        this.open.set(false);
      }
    });

    const onScroll = (event: Event) => {
      const panel = this.panel()?.nativeElement;
      const target = event.target as Node | null;

      // Прокрутка самого списка не должна его закрывать.
      if (panel && target && panel.contains(target)) {
        return;
      }

      this.close();
    };

    effect((onCleanup) => {
      // Мультивыбор живёт в фильтре таблицы: прокрутка тела не должна
      // закрывать список, пока отмечают несколько пунктов.
      if (!this.open() || this.multiple()) {
        return;
      }

      document.addEventListener('scroll', onScroll, true);
      onCleanup(() => document.removeEventListener('scroll', onScroll, true));
    });

    inject(DestroyRef).onDestroy(() => document.removeEventListener('scroll', onScroll, true));
  }

  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }

    const trigger = this.host.nativeElement.getBoundingClientRect();
    this.position.set({
      top: trigger.bottom + GAP,
      left: Math.min(Math.max(EDGE, trigger.left), window.innerWidth - trigger.width - EDGE),
      width: trigger.width,
    });
    this.open.set(true);

    afterNextRender(
      () => {
        const panel = this.panel()?.nativeElement;
        if (!panel) {
          return;
        }

        const { height, width } = panel.getBoundingClientRect();
        const left = Math.min(
          Math.max(EDGE, trigger.left),
          window.innerWidth - Math.max(width, trigger.width) - EDGE,
        );

        if (trigger.bottom + GAP + height > window.innerHeight - EDGE) {
          this.position.set({
            top: Math.max(EDGE, trigger.top - GAP - height),
            left,
            width: trigger.width,
          });
          return;
        }

        this.position.update((current) => ({ ...current, left }));
      },
      { injector: this.injector },
    );
  }

  protected choose(option: SelectOption): void {
    if (this.multiple()) {
      const values = new Set(asValues(this.value()));

      if (values.has(option.value)) {
        values.delete(option.value);
      } else {
        values.add(option.value);
      }

      this.selectedValues.emit(
        this.options()
          .map((item) => item.value)
          .filter((item) => values.has(item)),
      );
      return;
    }

    this.close();

    if (option.value !== this.value()) {
      this.selected.emit(option.value);
    }
  }

  protected isSelected(option: SelectOption): boolean {
    return this.selectedOptions().some((item) => item.value === option.value);
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

function asValues(value: SelectValue | readonly SelectValue[] | null): SelectValue[] {
  return Array.isArray(value) ? [...value] : [];
}
