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
  ArrowDownWideNarrow,
  BadgeCheck,
  Check,
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
  Select,
  type SelectOption,
  type SelectValue,
} from '../../../../shared/components/select/select';
import { Spinner } from '../../../../shared/components/spinner/spinner';
import { Menu, MenuTrigger } from '../../../../shared/components/menu/menu';
import { MenuItem } from '../../../../shared/components/menu/menu-item';
import { Table } from '../../../../shared/components/table/table';
import { TableColumn } from '../../../../shared/components/table/table-column';
import { Toolbar } from '../../../../shared/components/toolbar/toolbar';
import { Confirm } from '../../../../shared/services/confirm';
import { PageHeader } from '../../../../shared/services/page-header';
import { Toasts } from '../../../../shared/services/toasts';
import { Umag } from '../../../extensions/services/umag';
import {
  type PurchasePlan,
  type PurchasePlanItem,
  type SortMode,
  formatAmount,
  formatCover,
  formatMoney,
  groupBySupplier,
  isBuilding,
  isOut,
  planTitle,
  sortGroups,
} from '../../models/plan';
import { Planning } from '../../services/planning';

/** Пока план считается, спрашиваем его так же часто, как статус накладной. */
const POLL_INTERVAL = 2500;

/** Сколько держим подпись на экране между появлением и исчезновением. */
const HINT_HOLD_MS = 3000;

/** Столько же длится `hint-in` и `hint-out` в `styles.css`. */
const HINT_FADE_MS = 400;

/** Столько же длится `accordion-out` в `styles.css`. */
const COLLAPSE_MS = 200;

const PERIODS: SelectOption[] = [
  { value: 7, label: 'Расход за неделю' },
  { value: 14, label: 'Расход за 2 недели' },
  { value: 30, label: 'Расход за месяц' },
  { value: 60, label: 'Расход за 2 месяца' },
];

const SORTS: SelectOption[] = [
  { value: 'urgent', label: 'Сначала горящие' },
  { value: 'cost', label: 'Сначала крупные' },
  { value: 'name', label: 'По названию' },
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
    Menu,
    MenuItem,
    MenuTrigger,
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
  protected readonly openIcon = ChevronRight;
  protected readonly outIcon = TriangleAlert;
  protected readonly filterIcon = SlidersHorizontal;
  protected readonly sortIcon = ArrowDownWideNarrow;
  protected readonly chosenIcon = Check;
  protected readonly approveIcon = BadgeCheck;
  protected readonly lowIcon = Clock;

  protected readonly periods = PERIODS;
  protected readonly sorts = SORTS;
  protected readonly horizons = HORIZONS;

  protected readonly formatAmount = formatAmount;
  protected readonly formatCover = formatCover;
  protected readonly formatMoney = formatMoney;
  protected readonly isOut = isOut;

  protected readonly plan = signal<PurchasePlan | null>(null);
  protected readonly missing = signal(false);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly cancelling = signal(false);
  protected readonly approving = signal('');

  protected readonly sort = signal<SortMode>('urgent');
  protected readonly filterOpen = signal(false);

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

  protected readonly groups = computed(() =>
    sortGroups(groupBySupplier(this.items()), this.sort()),
  );

  protected readonly opened = signal<ReadonlySet<string>>(new Set());
  private readonly closing = signal<ReadonlySet<string>>(new Set());
  protected readonly visible = computed(() => new Set([...this.opened(), ...this.closing()]));

  protected readonly trackItem = (item: PurchasePlanItem) => item.position;

  private readonly filter = viewChild<ElementRef<HTMLElement>>('filter');

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly collapseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private version = 0;

  constructor() {
    effect(() => {
      const plan = this.plan();
      this.header.setCrumbs([
        { label: 'Планирование закупов', route: '/purchases' },
        { label: plan ? planTitle(plan) : 'Планировка' },
      ]);
    });

    effect(() => {
      this.groups();
      this.stopCollapsing();
      this.opened.set(new Set());
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
      this.stopCollapsing();
      this.header.clear();
    });
  }

  protected toggle(key: string): void {
    this.clearCollapseTimer(key);

    if (!this.opened().has(key)) {
      this.closing.update((current) => without(current, key));
      this.opened.update((current) => added(current, key));
      return;
    }

    this.opened.update((current) => without(current, key));
    this.closing.update((current) => added(current, key));

    this.collapseTimers.set(
      key,
      setTimeout(() => {
        this.collapseTimers.delete(key);
        this.closing.update((current) => without(current, key));
      }, COLLAPSE_MS),
    );
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

  protected setSort(value: SelectValue): void {
    this.sort.set(value as SortMode);
  }

  protected setDays(value: SelectValue): void {
    this.days.set(Number(value));
  }

  protected setHorizon(value: SelectValue): void {
    this.horizon.set(Number(value));
  }

  protected async approve(group: { supplier: string; items: PurchasePlanItem[] }): Promise<void> {
    if (this.approving() || this.busy() || this.building()) {
      return;
    }

    const plan = this.plan();
    const supplier = group.items[0]?.supplier ?? '';
    const label = group.supplier;

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

  private clearCollapseTimer(key: string): void {
    const timer = this.collapseTimers.get(key);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.collapseTimers.delete(key);
    }
  }

  private stopCollapsing(): void {
    for (const timer of this.collapseTimers.values()) {
      clearTimeout(timer);
    }

    this.collapseTimers.clear();
    this.closing.set(new Set());
  }
}

function added(current: ReadonlySet<string>, value: string): ReadonlySet<string> {
  return new Set(current).add(value);
}

function without(current: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(current);
  next.delete(value);

  return next;
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
