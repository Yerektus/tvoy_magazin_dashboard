import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { X } from 'lucide';

import { Button } from '../button/button';
import { Icon } from '../icon/icon';

/** Ширина панели с двумя полями. */
const PANEL_WIDTH = 260;
const GAP = 4;
const EDGE = 8;

/** Выбранный диапазон; пустая строка — граница не задана. */
export interface NumberRangeValue {
  from: string;
  to: string;
}

/**
 * Фильтр «от — до» для числа:
 *
 * ```html
 * <app-number-range
 *   [from]="soldFrom()"
 *   [to]="soldTo()"
 *   (rangeChange)="filterSoldRange($event)"
 * />
 * ```
 *
 * Поле выглядит как инпут с подписью «От-До». Окно открывается кликом по
 * нему целиком. Панель висит на `fixed`-координатах — иначе её обрезал бы
 * скроллящийся контейнер таблицы.
 */
@Component({
  selector: 'app-number-range',
  imports: [Button, Icon],
  templateUrl: './number-range.html',
  host: {
    class: 'relative block w-full',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'close()',
    '(window:resize)': 'close()',
  },
})
export class NumberRange {
  readonly from = input('');
  readonly to = input('');
  readonly rangeChange = output<NumberRangeValue>();

  protected readonly open = signal(false);
  /** Панель позиционируется fixed — иначе её обрезал бы скролл таблицы. */
  protected readonly position = signal({ top: 0, left: 0 });
  protected readonly clearIcon = X;

  /** Подпись на поле: применённый диапазон или плейсхолдер. */
  protected readonly label = computed(() => {
    const from = this.from().trim();
    const to = this.to().trim();

    if (from && to) {
      return from === to ? from : `${from} – ${to}`;
    }

    return from ? `от ${from}` : to ? `до ${to}` : '';
  });

  /** Черновик: правится в окне, уходит по «Применить». */
  protected readonly draftFrom = signal('');
  protected readonly draftTo = signal('');

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly fromInput = viewChild<ElementRef<HTMLInputElement>>('fromInput');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  constructor() {
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

  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }

    this.draftFrom.set(this.from());
    this.draftTo.set(this.to());

    const trigger = this.host.nativeElement.getBoundingClientRect();
    this.position.set({
      top: trigger.bottom + GAP,
      left: Math.min(Math.max(EDGE, trigger.left), window.innerWidth - PANEL_WIDTH - EDGE),
    });
    this.open.set(true);

    afterNextRender(
      () => {
        const panel = this.panel()?.nativeElement;
        if (!panel) {
          return;
        }

        const { height } = panel.getBoundingClientRect();
        if (trigger.bottom + GAP + height > window.innerHeight - EDGE) {
          this.position.update((current) => ({
            ...current,
            top: Math.max(EDGE, trigger.top - GAP - height),
          }));
        }

        this.fromInput()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  protected close(): void {
    this.open.set(false);
  }

  /** Клик мимо закрывает окно без применения — черновик выбрасывается. */
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

  /** Крестик на поле: сбрасывает диапазон сразу, окно не открывает. */
  protected clearTrigger(event: Event): void {
    event.stopPropagation();
    this.draftFrom.set('');
    this.draftTo.set('');
    this.emitIfChanged('', '');
  }

  protected changeFrom(event: Event): void {
    this.draftFrom.set((event.target as HTMLInputElement).value);
  }

  protected changeTo(event: Event): void {
    this.draftTo.set((event.target as HTMLInputElement).value);
  }

  protected clear(): void {
    this.draftFrom.set('');
    this.draftTo.set('');
    this.emitIfChanged('', '');
  }

  protected apply(): void {
    let from = this.draftFrom().trim();
    let to = this.draftTo().trim();
    const fromNumber = parseAmount(from);
    const toNumber = parseAmount(to);

    if (fromNumber != null && toNumber != null && fromNumber > toNumber) {
      [from, to] = [to, from];
    }

    this.draftFrom.set(from);
    this.draftTo.set(to);
    this.emitIfChanged(from, to);
  }

  /** Не дёргаем список, если диапазон не поменялся, — просто закрываем окно. */
  private emitIfChanged(from: string, to: string): void {
    this.close();

    if (from !== this.from() || to !== this.to()) {
      this.rangeChange.emit({ from, to });
    }
  }
}

function parseAmount(value: string): number | null {
  const text = value.replace(/\s/g, '').replace(',', '.');

  if (!text || !/^\d+(\.\d+)?$/.test(text)) {
    return null;
  }

  return Number(text);
}
