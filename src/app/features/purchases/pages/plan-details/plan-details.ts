import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCw,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide';

import { Button } from '../../../../shared/components/button/button';
import { Checkbox } from '../../../../shared/components/checkbox/checkbox';
import { Empty } from '../../../../shared/components/empty/empty';
import { Icon } from '../../../../shared/components/icon/icon';
import {
  NumberRange,
  type NumberRangeValue,
} from '../../../../shared/components/number-range/number-range';
import {
  Select,
  type SelectOption,
  type SelectValue,
} from '../../../../shared/components/select/select';
import { Spinner } from '../../../../shared/components/spinner/spinner';
import { Menu } from '../../../../shared/components/menu/menu';
import { MenuItem } from '../../../../shared/components/menu/menu-item';
import { Table } from '../../../../shared/components/table/table';
import { TableColumn } from '../../../../shared/components/table/table-column';
import { Toolbar } from '../../../../shared/components/toolbar/toolbar';
import { Confirm } from '../../../../shared/services/confirm';
import { PageHeader } from '../../../../shared/services/page-header';
import { Toasts } from '../../../../shared/services/toasts';
import { Umag } from '../../../extensions/services/umag';
import {
  ACCURACY_FILTER_OPTIONS,
  type AccuracyLevel,
  type PurchasePlan,
  type PurchasePlanItem,
  accuracyClasses,
  accuracyIcon,
  accuracyLabel,
  accuracyLevel,
  formatAmount,
  formatCover,
  formatMoney,
  isBuilding,
  isOut,
  planTitle,
} from '../../models/plan';
import { Planning } from '../../services/planning';

/** Пока план считается, спрашиваем его так же часто, как статус накладной. */
const POLL_INTERVAL = 2500;

/** Сколько держим подпись на экране между появлением и исчезновением. */
const HINT_HOLD_MS = 3000;

/** Столько же длится `hint-in` и `hint-out` в `styles.css`. */
const HINT_FADE_MS = 400;

/** Сколько строк на одной странице таблицы. */
const PAGE_SIZE = 50;

type SortColumn = 'name' | 'barcode' | 'supplier' | 'stock' | 'cover' | 'suggested' | 'cost' | 'accuracy';
type SortDirection = 'asc' | 'desc';

const ACCURACY_ORDER: Record<AccuracyLevel, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

const UNKNOWN_SUPPLIER = 'Поставщик не определён';

const PERIODS: SelectOption[] = [
  { value: 7, label: 'Расход за неделю' },
  { value: 14, label: 'Расход за 2 недели' },
  { value: 30, label: 'Расход за месяц' },
  { value: 60, label: 'Расход за 2 месяца' },
];

const HORIZONS: SelectOption[] = [
  { value: 3, label: 'Закуп на 3 дня' },
  { value: 7, label: 'Закуп на неделю' },
  { value: 14, label: 'Закуп на 2 недели' },
  { value: 30, label: 'Закуп на месяц' },
];

/**
 * Карточка планировки: пока считается — спиннер, потом позиции по поставщикам.
 */
@Component({
  selector: 'app-plan-details',
  imports: [
    Button,
    Checkbox,
    Empty,
    Icon,
    NumberRange,
    Menu,
    MenuItem,
    Select,
    Spinner,
    Table,
    TableColumn,
    Toolbar,
  ],
  templateUrl: './plan-details.html',
  host: {
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'filterOpen.set(false)',
  },
})
export class PlanDetails {
  /** Приходит из `:id` в маршруте. */
  readonly id = input.required<string>();

  protected readonly retryIcon = RefreshCw;
  protected readonly outIcon = TriangleAlert;
  protected readonly filterIcon = SlidersHorizontal;
  protected readonly approveIcon = BadgeCheck;
  protected readonly lowIcon = Clock;
  protected readonly prevIcon = ChevronLeft;
  protected readonly nextIcon = ChevronRight;
  protected readonly sortUpIcon = ArrowUp;
  protected readonly sortDownIcon = ArrowDown;

  protected readonly periods = PERIODS;
  protected readonly horizons = HORIZONS;
  protected readonly accuracyOptions = ACCURACY_FILTER_OPTIONS;

  protected readonly formatAmount = formatAmount;
  protected readonly formatCover = formatCover;
  protected readonly formatMoney = formatMoney;
  protected readonly isOut = isOut;
  protected readonly accuracyLabel = accuracyLabel;
  protected readonly accuracyIcon = accuracyIcon;
  protected readonly accuracyClasses = accuracyClasses;
  protected readonly supplierName = supplierName;

  protected readonly plan = signal<PurchasePlan | null>(null);
  protected readonly missing = signal(false);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly cancelling = signal(false);
  protected readonly approving = signal('');

  protected readonly filterOpen = signal(false);
  protected readonly query = signal('');
  protected readonly barcodeQuery = signal('');
  protected readonly supplierQuery = signal('');
  protected readonly accuracyFilter = signal<AccuracyLevel | ''>('');
  protected readonly stockFrom = signal('');
  protected readonly stockTo = signal('');
  protected readonly coverFrom = signal('');
  protected readonly coverTo = signal('');
  protected readonly suggestedFrom = signal('');
  protected readonly suggestedTo = signal('');
  protected readonly costFrom = signal('');
  protected readonly costTo = signal('');
  protected readonly page = signal(1);
  protected readonly sortColumn = signal<SortColumn>('cover');
  protected readonly sortDirection = signal<SortDirection>('asc');

  protected readonly days = signal(30);
  protected readonly horizon = signal(14);
  protected readonly useStock = signal(true);

  private readonly planning = inject(Planning);
  private readonly umag = inject(Umag);
  private readonly header = inject(PageHeader);
  private readonly toasts = inject(Toasts);
  private readonly confirm = inject(Confirm);
  private readonly router = inject(Router);

  protected readonly items = computed<PurchasePlanItem[]>(() => this.plan()?.items ?? []);
  protected readonly building = computed(() => isBuilding(this.plan()));
  protected readonly failed = computed(() => this.plan()?.status === 'failed');
  protected readonly calculating = computed(() => this.building() || this.busy());

  protected readonly hint = signal('');
  protected readonly hintPhase = signal<'in' | 'out' | ''>('');

  protected readonly filtering = computed(
    () =>
      this.query().trim().length > 0 ||
      this.barcodeQuery().trim().length > 0 ||
      this.supplierQuery().trim().length > 0 ||
      this.accuracyFilter().length > 0 ||
      this.stockFrom().length > 0 ||
      this.stockTo().length > 0 ||
      this.coverFrom().length > 0 ||
      this.coverTo().length > 0 ||
      this.suggestedFrom().length > 0 ||
      this.suggestedTo().length > 0 ||
      this.costFrom().length > 0 ||
      this.costTo().length > 0,
  );

  protected readonly filteredItems = computed(() => {
    const query = this.query().trim().toLowerCase();
    const barcode = this.barcodeQuery().trim().toLowerCase();
    const supplier = this.supplierQuery().trim().toLowerCase();
    const accuracy = this.accuracyFilter();
    const stock = orderedBounds(this.stockFrom(), this.stockTo());
    const cover = orderedBounds(this.coverFrom(), this.coverTo());
    const suggested = orderedBounds(this.suggestedFrom(), this.suggestedTo());
    const cost = orderedBounds(this.costFrom(), this.costTo());

    return this.items().filter((item) => {
      if (query && !item.name.toLowerCase().includes(query)) {
        return false;
      }

      if (barcode && !item.barcode.toLowerCase().includes(barcode)) {
        return false;
      }

      if (supplier && !supplierName(item).toLowerCase().includes(supplier)) {
        return false;
      }

      if (accuracy && accuracyLevel(item.forecast_error) !== accuracy) {
        return false;
      }

      if (!inRange(Number(item.stock), stock)) {
        return false;
      }

      if (!inRange(Number(item.cover_days ?? NaN), cover)) {
        return false;
      }

      if (!inRange(Number(item.suggested), suggested)) {
        return false;
      }

      if (!inRange(Number(item.cost ?? NaN), cost)) {
        return false;
      }

      return true;
    });
  });

  protected readonly sortedItems = computed(() => {
    const column = this.sortColumn();
    const direction = this.sortDirection() === 'asc' ? 1 : -1;

    return [...this.filteredItems()].sort(
      (first, second) => direction * compareItems(first, second, column),
    );
  });

  protected readonly total = computed(() => this.filteredItems().length);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly shownPage = computed(() => Math.min(this.page(), this.pageCount()));
  protected readonly shownItems = computed(() => {
    const start = (this.shownPage() - 1) * PAGE_SIZE;

    return this.sortedItems().slice(start, start + PAGE_SIZE);
  });
  protected readonly rangeStart = computed(() => {
    if (!this.total()) {
      return 0;
    }

    return (this.shownPage() - 1) * PAGE_SIZE + 1;
  });
  protected readonly rangeEnd = computed(() =>
    Math.min(this.shownPage() * PAGE_SIZE, this.total()),
  );
  protected readonly rangeLabel = computed(() => {
    const total = this.total().toLocaleString('ru-RU');

    return `${this.rangeStart()}–${this.rangeEnd()} из ${total}`;
  });
  protected readonly emptyText = computed(() =>
    this.filtering() ? 'Ничего не нашлось' : 'Всего хватает — заказывать нечего',
  );

  protected readonly trackItem = (item: PurchasePlanItem) => item.position;

  private readonly filter = viewChild<ElementRef<HTMLElement>>('filter');

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private version = 0;

  constructor() {
    effect(() => {
      const plan = this.plan();
      this.header.setCrumbs([
        { label: 'Планирование закупов', route: '/purchases' },
        plan
          ? { label: planTitle(plan) }
          : this.missing()
            ? { label: 'Планировка' }
            : { label: '', loading: true },
      ]);
    });

    effect(() => {
      const id = Number(this.id());
      this.umag.account()?.targetId;
      untracked(() => void this.load(id));
    });

    effect((onCleanup) => {
      if (!this.calculating()) {
        untracked(() => {
          this.hint.set('');
          this.hintPhase.set('');
        });
        return;
      }

      let index = 0;
      let cancelled = false;
      const timers: ReturnType<typeof setTimeout>[] = [];

      const schedule = (fn: () => void, ms: number) => {
        timers.push(
          setTimeout(() => {
            if (!cancelled) {
              fn();
            }
          }, ms),
        );
      };

      const cycle = () => {
        const steps = this.hintSteps();
        const text = steps[index % steps.length] ?? '';

        this.hint.set(text);
        this.hintPhase.set('in');

        schedule(() => {
          this.hintPhase.set('');

          schedule(() => {
            this.hintPhase.set('out');

            schedule(() => {
              index += 1;
              cycle();
            }, HINT_FADE_MS);
          }, HINT_HOLD_MS);
        }, HINT_FADE_MS);
      };

      untracked(cycle);

      onCleanup(() => {
        cancelled = true;

        for (const timer of timers) {
          clearTimeout(timer);
        }
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.stopPolling();
      this.header.clear();
    });
  }

  protected search(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  protected searchBarcode(event: Event): void {
    this.barcodeQuery.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  protected searchSupplier(event: Event): void {
    this.supplierQuery.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  protected filterAccuracy(value: SelectValue): void {
    this.accuracyFilter.set(value as AccuracyLevel | '');
    this.page.set(1);
  }

  protected filterStockRange(range: NumberRangeValue): void {
    this.stockFrom.set(range.from);
    this.stockTo.set(range.to);
    this.page.set(1);
  }

  protected filterCoverRange(range: NumberRangeValue): void {
    this.coverFrom.set(range.from);
    this.coverTo.set(range.to);
    this.page.set(1);
  }

  protected filterSuggestedRange(range: NumberRangeValue): void {
    this.suggestedFrom.set(range.from);
    this.suggestedTo.set(range.to);
    this.page.set(1);
  }

  protected filterCostRange(range: NumberRangeValue): void {
    this.costFrom.set(range.from);
    this.costTo.set(range.to);
    this.page.set(1);
  }

  protected toggleSort(column: SortColumn): void {
    const order: SortDirection =
      this.sortColumn() === column
        ? this.sortDirection() === 'asc'
          ? 'desc'
          : 'asc'
        : column === 'name' || column === 'barcode' || column === 'supplier' || column === 'accuracy'
          ? 'asc'
          : 'desc';

    this.sortColumn.set(column);
    this.sortDirection.set(order);
    this.page.set(1);
  }

  protected isSorted(column: SortColumn): boolean {
    return this.sortColumn() === column;
  }

  protected sortIcon(column: SortColumn) {
    if (!this.isSorted(column)) {
      return null;
    }

    return this.sortDirection() === 'asc' ? this.sortUpIcon : this.sortDownIcon;
  }

  protected goTo(page: number): void {
    const next = Math.min(Math.max(1, page), this.pageCount());

    if (next === this.shownPage()) {
      return;
    }

    this.page.set(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected openItem(item: PurchasePlanItem): void {
    if (!item.barcode) {
      return;
    }

    void this.router.navigate(['/products', item.barcode]);
  }

  protected onDocumentPointerDown(event: Event): void {
    const target = event.target as Node | null;

    if (this.filterOpen() && target && !this.filter()?.nativeElement.contains(target)) {
      this.filterOpen.set(false);
    }
  }

  protected async apply(): Promise<void> {
    this.filterOpen.set(false);
    await this.rebuild();
  }

  protected async cancel(): Promise<void> {
    if (this.cancelling()) {
      return;
    }

    const id = this.plan()?.id ?? Number(this.id());
    const version = ++this.version;

    this.stopPolling();
    this.cancelling.set(true);
    this.busy.set(false);

    try {
      await this.planning.cancel(id);
      void this.router.navigateByUrl('/purchases');
    } catch (error) {
      if (version !== this.version) {
        return;
      }

      this.toasts.error(error instanceof Error ? error.message : 'Не удалось отменить расчёт');
    } finally {
      if (version === this.version) {
        this.cancelling.set(false);
      }
    }
  }

  private hintSteps(): string[] {
    const plan = this.plan();
    const horizon = plan?.horizon ?? this.horizon();
    const steps = ['Смотрим, что продавалось за период'];

    if (this.useStock()) {
      steps.push('Сверяем, сколько ещё осталось на складе');
    }

    steps.push('Ищем, самые продаваемые позиции', `Считаем, чего не хватит ${forHorizon(horizon)}`);

    return steps;
  }

  protected setDays(value: SelectValue): void {
    this.days.set(Number(value));
  }

  protected setHorizon(value: SelectValue): void {
    this.horizon.set(Number(value));
  }

  protected async approveItem(item: PurchasePlanItem): Promise<void> {
    if (this.approving() || this.busy() || this.building()) {
      return;
    }

    const plan = this.plan();
    const supplier = item.supplier;
    const label = supplierName(item);

    if (!plan) {
      return;
    }

    const agreed = await this.confirm.ask({
      title: 'Одобрить закуп?',
      message: `Позиции «${label}» уйдут из плана в одобренные. Пересчёт их уже не затрёт.`,
      confirmLabel: 'Одобрить',
    });

    if (!agreed) {
      return;
    }

    this.approving.set(label);

    try {
      await this.planning.approve(supplier, plan.id);
      this.plan.set(await this.planning.planById(plan.id));
      this.toasts.success(`Одобрен закуп у «${label}»`);
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось одобрить закуп');
    } finally {
      this.approving.set('');
    }
  }

  /** Считает эту планировку заново: имя остаётся, строки собираются с нуля. */
  protected async rebuild(): Promise<void> {
    if (this.busy()) {
      return;
    }

    const id = this.plan()?.id ?? Number(this.id());
    const version = this.version;

    this.busy.set(true);

    try {
      const plan = await this.planning.recount(id, this.days(), this.horizon(), this.useStock());

      if (version !== this.version) {
        return;
      }

      this.plan.set(plan);
      this.poll();
    } catch (error) {
      if (version !== this.version) {
        return;
      }

      this.toasts.error(error instanceof Error ? error.message : 'Не удалось посчитать план');
    } finally {
      if (version === this.version) {
        this.busy.set(false);
      }
    }
  }

  private async load(id: number): Promise<void> {
    if (!Number.isFinite(id) || id < 1) {
      this.missing.set(true);
      this.loading.set(false);
      return;
    }

    const version = ++this.version;

    this.stopPolling();
    this.loading.set(true);
    this.missing.set(false);
    this.plan.set(null);

    try {
      if (this.planning.account() === null) {
        await this.planning.load();
      }

      const plan = await this.planning.planById(id);

      if (version !== this.version) {
        return;
      }

      this.plan.set(plan);
      this.days.set(plan.days);
      this.horizon.set(plan.horizon);
      this.useStock.set(plan.use_stock ?? true);
      this.query.set('');
      this.barcodeQuery.set('');
      this.supplierQuery.set('');
      this.accuracyFilter.set('');
      this.stockFrom.set('');
      this.stockTo.set('');
      this.coverFrom.set('');
      this.coverTo.set('');
      this.suggestedFrom.set('');
      this.suggestedTo.set('');
      this.costFrom.set('');
      this.costTo.set('');
      this.page.set(1);
      this.sortColumn.set('cover');
      this.sortDirection.set('asc');
      this.poll();
    } catch (error) {
      if (version !== this.version) {
        return;
      }

      this.missing.set(true);
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось открыть план');
    } finally {
      if (version === this.version) {
        this.loading.set(false);
      }
    }
  }

  private poll(): void {
    this.stopPolling();

    if (!this.building()) {
      return;
    }

    const version = this.version;
    const id = this.plan()?.id ?? Number(this.id());

    this.pollTimer = setTimeout(async () => {
      try {
        const plan = await this.planning.planById(id);

        if (version !== this.version) {
          return;
        }

        this.plan.set(plan);
      } catch {
        // Сеть моргнула — попробуем на следующем круге.
      }

      this.announce();
      this.poll();
    }, POLL_INTERVAL);
  }

  private announce(): void {
    const plan = this.plan();

    if (plan?.status === 'ready') {
      this.toasts.success(`План готов: ${plan.items_total} позиций к заказу`);
    }

    if (plan?.status === 'failed') {
      this.toasts.error(plan.error || 'Не удалось посчитать план');
    }
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

function supplierName(item: PurchasePlanItem): string {
  return item.supplier || UNKNOWN_SUPPLIER;
}

function compareItems(first: PurchasePlanItem, second: PurchasePlanItem, column: SortColumn): number {
  if (column === 'name') {
    return first.name.localeCompare(second.name, 'ru');
  }

  if (column === 'barcode') {
    return first.barcode.localeCompare(second.barcode, 'ru');
  }

  if (column === 'supplier') {
    return supplierName(first).localeCompare(supplierName(second), 'ru');
  }

  if (column === 'accuracy') {
    return ACCURACY_ORDER[accuracyLevel(first.forecast_error)] - ACCURACY_ORDER[accuracyLevel(second.forecast_error)];
  }

  if (column === 'cover') {
    return Number(first.cover_days ?? Number.POSITIVE_INFINITY) - Number(second.cover_days ?? Number.POSITIVE_INFINITY);
  }

  return Number(first[column] ?? 0) - Number(second[column] ?? 0);
}

function inRange(value: number, bounds: { from?: string; to?: string }): boolean {
  if (bounds.from != null && !(value >= Number(bounds.from))) {
    return false;
  }

  if (bounds.to != null && !(value <= Number(bounds.to))) {
    return false;
  }

  return true;
}

function orderedBounds(fromRaw: string, toRaw: string): { from?: string; to?: string } {
  const from = parseBound(fromRaw);
  const to = parseBound(toRaw);

  if (from != null && to != null && Number(from) > Number(to)) {
    return { from: to, to: from };
  }

  return { from, to };
}

function parseBound(value: string): string | undefined {
  const text = value.trim().replace(/\s/g, '').replace(',', '.');

  if (!text || !/^\d+(\.\d+)?$/.test(text)) {
    return undefined;
  }

  return text;
}

function forHorizon(days: number): string {
  if (days === 3) {
    return 'на 3 дня';
  }

  if (days === 7) {
    return 'на неделю';
  }

  if (days === 14) {
    return 'на две недели';
  }

  if (days === 30) {
    return 'на месяц';
  }

  return `на ${days} дней`;
}
