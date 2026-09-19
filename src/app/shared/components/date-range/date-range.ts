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
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide';

import { Button } from '../button/button';
import { Icon } from '../icon/icon';

/** Ширина панели: один месяц календаря. */
const PANEL_WIDTH = 304;
const GAP = 4;
const EDGE = 8;

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Выбранный период в формате `YYYY-MM-DD`; пустая строка — граница не задана. */
export interface DateRangeValue {
  from: string;
  to: string;
}

interface DayCell {
  iso: string;
  label: number;
  disabled: boolean;
  /** День соседнего месяца: виден диммированным, клик листает к нему. */
  outside: boolean;
}

/**
 * Фильтр периода с кастомным календарём:
 *
 * ```html
 * <app-date-range
 *   [from]="lastFrom()"
 *   [to]="lastTo()"
 *   (rangeChange)="filterLastRange($event)"
 * />
 * ```
 *
 * Окно открывается кликом по всему полю, а не по иконке. Панель висит на
 * `fixed`-координатах — иначе её обрезал бы скроллящийся контейнер таблицы.
 */
@Component({
  selector: 'app-date-range',
  imports: [Button, Icon],
  templateUrl: './date-range.html',
  host: {
    class: 'relative block w-full',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'close()',
    '(window:resize)': 'close()',
  },
})
export class DateRange {
  /** Применённое начало периода `YYYY-MM-DD` (или пусто). */
  readonly from = input('');
  /** Применённый конец периода `YYYY-MM-DD` (или пусто). */
  readonly to = input('');
  /** Крестик на поле: без него период только меняют календарём. */
  readonly clearable = input(true, { transform: booleanAttribute });
  /** Период применили вторым кликом по дню или сбросили крестиком. */
  readonly rangeChange = output<DateRangeValue>();

  protected readonly open = signal(false);
  /** Панель позиционируется fixed — иначе её обрезал бы скролл таблицы. */
  protected readonly position = signal({ top: 0, left: 0 });

  protected readonly calendarIcon = Calendar;
  protected readonly prevIcon = ChevronLeft;
  protected readonly nextIcon = ChevronRight;
  protected readonly clearIcon = X;
  protected readonly weekdays = WEEKDAYS;

  /** Подпись на поле: применённый период или плейсхолдер. */
  protected readonly label = computed(() => {
    const from = formatIsoRu(this.from());
    const to = formatIsoRu(this.to());

    if (from && to) {
      return from === to ? from : `${from} – ${to}`;
    }

    return from ? `с ${from}` : to ? `по ${to}` : '';
  });

  /** Месяц, который сейчас листаем. */
  private readonly base = signal({ y: 0, m: 0 });
  /** Сегодня `YYYY-MM-DD`: дни позже недоступны. */
  private readonly today = signal('');
  /** Черновик: правится кликами по календарю, уходит по «Применить». */
  private readonly draftFrom = signal('');
  private readonly draftTo = signal('');
  private readonly hovered = signal('');

  protected readonly monthTitle = computed(() => {
    const { y, m } = this.base();
    return `${MONTHS[m]} ${y}`;
  });

  /** Дальше текущего месяца листать некуда — будущее и так недоступно. */
  protected readonly canNext = computed(() => {
    const [year, month] = this.today().split('-').map(Number);
    return this.base().y * 12 + this.base().m < year * 12 + (month - 1);
  });

  /** Сетка всегда 6×7: хвост и голова соседних месяцев видны диммированными. */
  protected readonly cells = computed<DayCell[]>(() => {
    const { y, m } = this.base();
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const daysInPrev = new Date(y, m, 0).getDate();
    const today = this.today();
    const cells: DayCell[] = [];

    for (let day = daysInPrev - offset + 1; day <= daysInPrev; day++) {
      const iso = toIsoDate(new Date(y, m - 1, day));
      cells.push({ iso, label: day, disabled: iso > today, outside: true });
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const iso = toIsoDate(new Date(y, m, day));
      cells.push({ iso, label: day, disabled: iso > today, outside: false });
    }

    for (let day = 1; cells.length < 6 * 7; day++) {
      const iso = toIsoDate(new Date(y, m + 1, day));
      cells.push({ iso, label: day, disabled: iso > today, outside: true });
    }

    return cells;
  });

  /** Границы подсветки: выбранное плюс наведение, пока конец не поставлен. */
  private readonly ordered = computed<[string, string] | null>(() => {
    const from = this.draftFrom();

    if (!from) {
      return null;
    }

    const to = this.draftTo() || this.hovered();

    if (!to) {
      return null;
    }

    return from <= to ? [from, to] : [to, from];
  });

  /** Подсказка, пока выбрано только начало: ждём клик по конечной дате. */
  protected readonly pickingEnd = computed(() => !!this.draftFrom() && !this.draftTo());

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  constructor() {
    // Панель висит на fixed-координатах, при прокрутке она бы «отклеилась»
    // от поля. Слушаем в фазе перехвата, чтобы ловить и внутренние скроллы.
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

    const today = toIsoDate(new Date());
    this.today.set(today);
    this.draftFrom.set(this.from());
    this.draftTo.set(this.to());
    this.hovered.set('');

    const anchor = this.to() || this.from() || today;
    const [year, month] = anchor.split('-').map(Number);
    this.base.set({ y: year, m: month - 1 });

    const trigger = this.host.nativeElement.getBoundingClientRect();
    this.position.set({
      top: trigger.bottom + GAP,
      left: Math.min(Math.max(EDGE, trigger.left), window.innerWidth - PANEL_WIDTH - EDGE),
    });
    this.open.set(true);

    // Высоту панели узнаём только после отрисовки: если снизу не помещается,
    // разворачиваем её вверх от поля.
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

  /** Крестик на поле: сбрасывает период сразу, окно не открывает. */
  protected clearTrigger(event: Event): void {
    event.stopPropagation();
    this.draftFrom.set('');
    this.draftTo.set('');
    this.emitIfChanged('', '');
  }

  protected pick(cell: DayCell): void {
    if (cell.disabled) {
      return;
    }

    // Клик по дню соседнего месяца сначала листает календарь к нему.
    if (cell.outside) {
      const [year, month] = cell.iso.split('-').map(Number);
      this.base.set({ y: year, m: month - 1 });
    }

    const from = this.draftFrom();
    const to = this.draftTo();

    if (!from || (from && to)) {
      this.draftFrom.set(cell.iso);
      this.draftTo.set('');
      this.hovered.set('');
      return;
    }

    // Второй клик закрывает период — фильтр применяется сразу.
    this.draftTo.set(cell.iso);
    this.hovered.set('');
    this.apply();
  }

  protected shiftMonth(delta: number): void {
    const { y, m } = this.base();
    const next = new Date(y, m + delta, 1);
    const [year, month] = this.today().split('-').map(Number);
    const max = year * 12 + (month - 1);

    if (next.getFullYear() * 12 + next.getMonth() > max) {
      this.base.set({ y: year, m: month - 1 });
      return;
    }

    this.base.set({ y: next.getFullYear(), m: next.getMonth() });
  }

  protected apply(): void {
    let from = this.draftFrom();
    let to = this.draftTo();

    if (from && to && from > to) {
      [from, to] = [to, from];
    }

    this.draftFrom.set(from);
    this.draftTo.set(to);
    this.emitIfChanged(from, to);
  }

  protected isEndpoint(iso: string): boolean {
    if (iso === this.draftFrom()) {
      return true;
    }

    if (this.draftTo() && iso === this.draftTo()) {
      return true;
    }

    // Кончик предпросмотра, пока конец периода ещё не кликнули.
    return !this.draftTo() && !!this.hovered() && iso === this.hovered();
  }

  protected isInside(iso: string): boolean {
    const range = this.ordered();
    return !!range && iso > range[0] && iso < range[1];
  }

  protected dayClass(cell: DayCell): string {
    if (cell.disabled) {
      return `cursor-default rounded-md ${cell.outside ? 'text-neutral-200' : 'text-neutral-300'}`;
    }

    // Концы полосы: скругление только снаружи, чтобы дни сливались в одну ленту.
    if (this.isEndpoint(cell.iso)) {
      const position = this.endpointPosition(cell.iso);
      const rounding =
        position === 'single' ? 'rounded-md' : position === 'start' ? 'rounded-l-md' : 'rounded-r-md';
      return `cursor-pointer ${rounding} bg-blue-500 font-medium text-white hover:bg-blue-600`;
    }

    if (this.isInside(cell.iso)) {
      return 'cursor-pointer rounded-none bg-blue-100 hover:bg-blue-200';
    }

    const tone = cell.outside ? 'text-neutral-400' : 'text-neutral-700';
    const todayMark = !cell.outside && cell.iso === this.today() ? ' font-semibold text-blue-600' : '';
    return `cursor-pointer rounded-md ${tone}${todayMark} hover:bg-neutral-100`;
  }

  /** Где точка в периоде: одиночный день или левый/правый конец ленты. */
  private endpointPosition(iso: string): 'single' | 'start' | 'end' {
    const range = this.ordered();

    if (!range || range[0] === range[1]) {
      return 'single';
    }

    return iso === range[0] ? 'start' : 'end';
  }

  protected hover(cell: DayCell): void {
    if (!cell.disabled && this.draftFrom() && !this.draftTo()) {
      this.hovered.set(cell.iso);
    }
  }

  protected unhover(): void {
    this.hovered.set('');
  }

  /** Не дёргаем список, если период не поменялся, — просто закрываем окно. */
  private emitIfChanged(from: string, to: string): void {
    this.close();

    if (from !== this.from() || to !== this.to()) {
      this.rangeChange.emit({ from, to });
    }
  }
}

/** `YYYY-MM-DD` → `ДД.ММ.ГГГГ` для поля и подписей. */
function formatIsoRu(value: string): string {
  if (!value) {
    return '';
  }

  const [year, month, day] = value.split('-');
  return day && month && year ? `${day}.${month}.${year}` : value;
}

function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
