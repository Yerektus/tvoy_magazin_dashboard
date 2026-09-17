import {
  Component,
  DestroyRef,
  TemplateRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ArrowDown, ArrowRight, ArrowUp, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide';

import { Button } from '../../../../shared/components/button/button';
import { DateRange, type DateRangeValue } from '../../../../shared/components/date-range/date-range';
import { Empty } from '../../../../shared/components/empty/empty';
import { Icon } from '../../../../shared/components/icon/icon';
import { Menu } from '../../../../shared/components/menu/menu';
import { MenuItem } from '../../../../shared/components/menu/menu-item';
import {
  NumberRange,
  type NumberRangeValue,
} from '../../../../shared/components/number-range/number-range';
import { Select, type SelectOption, type SelectValue } from '../../../../shared/components/select/select';
import { Spinner } from '../../../../shared/components/spinner/spinner';
import { Table } from '../../../../shared/components/table/table';
import { TableColumn } from '../../../../shared/components/table/table-column';
import { Toolbar } from '../../../../shared/components/toolbar/toolbar';
import { Confirm } from '../../../../shared/services/confirm';
import { PageHeader } from '../../../../shared/services/page-header';
import { Toasts } from '../../../../shared/services/toasts';
import { Umag } from '../../../extensions/services/umag';
import { CreatePlanDialog } from '../../components/create-plan-dialog/create-plan-dialog';
import {
  type ApprovedPurchase,
  type ApprovedPurchaseItem,
  type PlanStatus,
  type PurchasePlan,
  accuracyClasses,
  accuracyIcon,
  accuracyLabel,
  formatAmount,
  formatApprovedAt,
  formatCover,
  formatDate,
  formatMoney,
  formatTime,
  horizonLabel,
  isOut,
  planTitle,
  statusClasses,
  statusIcon,
  statusLabel,
} from '../../models/plan';
import { Planning } from '../../services/planning';

/** Пока план считается, список спрашиваем так же часто, как карточку. */
const POLL_INTERVAL = 2500;

/** Столько же длится `accordion-out` в `styles.css`. */
const COLLAPSE_MS = 200;

/** Сколько строк на одной странице таблицы. */
const PAGE_SIZE = 50;

type SortColumn = 'name' | 'horizon' | 'status' | 'items' | 'cost' | 'time';
type SortDirection = 'asc' | 'desc';

const STATUS_ORDER: Record<PlanStatus, number> = {
  building: 0,
  ready: 1,
  failed: 2,
};

const HORIZON_OPTIONS = [3, 7, 14, 30] as const;

/** Вкладки списка: таблица планировок и одобренные закупки. */
const TABS: Record<string, 'plan' | 'approved'> = {
  План: 'plan',
  Одобренные: 'approved',
};

/**
 * Список планировок: новые создают из окна, готовую открывают как накладную.
 */
@Component({
  selector: 'app-purchases',
  imports: [
    Button,
    CreatePlanDialog,
    DateRange,
    Empty,
    Icon,
    Menu,
    MenuItem,
    NumberRange,
    RouterLink,
    Select,
    Spinner,
    Table,
    TableColumn,
    Toolbar,
  ],
  templateUrl: './purchases.html',
})
export class Purchases {
  protected readonly addIcon = Plus;
  protected readonly openIcon = ArrowRight;
  protected readonly chevronIcon = ChevronRight;
  protected readonly removeIcon = Trash2;
  protected readonly prevIcon = ChevronLeft;
  protected readonly nextIcon = ChevronRight;
  protected readonly sortUpIcon = ArrowUp;
  protected readonly sortDownIcon = ArrowDown;
  protected readonly horizonOptions: SelectOption[] = [
    { value: '', label: 'Все' },
    ...HORIZON_OPTIONS.map((days) => ({ value: days, label: horizonLabel(days) })),
  ];
  protected readonly statusOptions: SelectOption[] = [
    { value: '', label: 'Все' },
    { value: 'building', label: statusLabel('building') },
    { value: 'ready', label: statusLabel('ready') },
    { value: 'failed', label: statusLabel('failed') },
  ];

  protected readonly formatAmount = formatAmount;
  protected readonly formatApprovedAt = formatApprovedAt;
  protected readonly formatCover = formatCover;
  protected readonly formatDate = formatDate;
  protected readonly formatMoney = formatMoney;
  protected readonly formatTime = formatTime;
  protected readonly horizonLabel = horizonLabel;
  protected readonly isOut = isOut;
  protected readonly planTitle = planTitle;
  protected readonly statusClasses = statusClasses;
  protected readonly statusIcon = statusIcon;
  protected readonly statusLabel = statusLabel;
  protected readonly accuracyLabel = accuracyLabel;
  protected readonly accuracyIcon = accuracyIcon;
  protected readonly accuracyClasses = accuracyClasses;

  protected readonly plans = signal<PurchasePlan[]>([]);
  protected readonly approved = signal<ApprovedPurchase[]>([]);
  protected readonly loading = signal(true);
  protected readonly dialogOpen = signal(false);
  protected readonly query = signal('');
  protected readonly horizonQuery = signal<number | ''>('');
  protected readonly statusFilter = signal<PlanStatus | ''>('');
  protected readonly itemsFrom = signal('');
  protected readonly itemsTo = signal('');
  protected readonly costFrom = signal('');
  protected readonly costTo = signal('');
  protected readonly dateFrom = signal('');
  protected readonly dateTo = signal('');
  protected readonly page = signal(1);
  protected readonly sortColumn = signal<SortColumn>('time');
  protected readonly sortDirection = signal<SortDirection>('desc');

  protected readonly opened = signal<ReadonlySet<string>>(new Set());
  private readonly closing = signal<ReadonlySet<string>>(new Set());
  protected readonly visible = computed(() => new Set([...this.opened(), ...this.closing()]));

  protected readonly trackPlan = (plan: PurchasePlan) => plan.id;
  protected readonly trackApproved = (purchase: ApprovedPurchase) => purchase.id;
  protected readonly trackItem = (item: ApprovedPurchaseItem) => item.position;

  private readonly planning = inject(Planning);
  private readonly umag = inject(Umag);
  private readonly header = inject(PageHeader);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly confirm = inject(Confirm);
  private readonly headerActions = viewChild<TemplateRef<unknown>>('headerActions');

  protected readonly connected = this.planning.connected;

  /**
   * Магазин, выбранный в шапке: планировки всегда по нему. `undefined` — про
   * UMAG ещё не спрашивали, и список рано грузить.
   */
  private readonly store = computed(() => this.umag.account()?.targetId);

  protected readonly tab = computed(() => TABS[this.header.activeTab() ?? ''] ?? 'plan');
  protected readonly onPlan = computed(() => this.tab() === 'plan');
  protected readonly onApproved = computed(() => this.tab() === 'approved');

  protected readonly filtering = computed(
    () =>
      this.query().trim().length > 0 ||
      this.horizonQuery() !== '' ||
      this.statusFilter().length > 0 ||
      this.itemsFrom().length > 0 ||
      this.itemsTo().length > 0 ||
      this.costFrom().length > 0 ||
      this.costTo().length > 0 ||
      this.dateFrom().length > 0 ||
      this.dateTo().length > 0,
  );

  protected readonly filteredPlans = computed(() => {
    const query = this.query().trim().toLowerCase();
    const horizon = this.horizonQuery();
    const status = this.statusFilter();
    const items = orderedBounds(this.itemsFrom(), this.itemsTo());
    const cost = orderedBounds(this.costFrom(), this.costTo());
    const dateFrom = this.dateFrom();
    const dateTo = this.dateTo();
    const from = dateFrom && dateTo && dateFrom > dateTo ? dateTo : dateFrom;
    const to = dateFrom && dateTo && dateFrom > dateTo ? dateFrom : dateTo;

    return this.plans().filter((plan) => {
      if (query && !planTitle(plan).toLowerCase().includes(query)) {
        return false;
      }

      if (horizon !== '' && plan.horizon !== horizon) {
        return false;
      }

      if (status && plan.status !== status) {
        return false;
      }

      const count = Number(plan.items_total);

      if (items.from != null && !(count >= Number(items.from))) {
        return false;
      }

      if (items.to != null && !(count <= Number(items.to))) {
        return false;
      }

      const amount = Number(plan.total_cost);

      if (cost.from != null && !(amount >= Number(cost.from))) {
        return false;
      }

      if (cost.to != null && !(amount <= Number(cost.to))) {
        return false;
      }

      const day = dateKey(plan.created_at);

      if (from && day < from) {
        return false;
      }

      if (to && day > to) {
        return false;
      }

      return true;
    });
  });

  protected readonly sortedPlans = computed(() => {
    const column = this.sortColumn();
    const direction = this.sortDirection() === 'asc' ? 1 : -1;

    return [...this.filteredPlans()].sort(
      (first, second) => direction * comparePlans(first, second, column),
    );
  });

  protected readonly total = computed(() => this.filteredPlans().length);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly shownPage = computed(() => Math.min(this.page(), this.pageCount()));
  protected readonly shownPlans = computed(() => {
    const start = (this.shownPage() - 1) * PAGE_SIZE;

    return this.sortedPlans().slice(start, start + PAGE_SIZE);
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
    this.filtering() ? 'Ничего не нашлось' : 'Планировок пока нет — создайте первую',
  );

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly collapseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private version = 0;

  constructor() {
    this.header.setTabs(Object.keys(TABS));

    effect(() => {
      const actions = this.headerActions();
      this.header.setActions(this.connected() && !this.loading() && actions ? actions : null);
    });

    effect(() => {
      const locked = !this.loading() && !this.connected();

      untracked(() => this.header.setTabs(locked ? [] : Object.keys(TABS)));
    });

    effect(() => {
      if (!this.onApproved()) {
        return;
      }

      this.approved();
      this.stopCollapsing();
      this.opened.set(new Set());
    });

    effect(() => {
      this.header.setBadges({ Одобренные: this.approved().length });
    });

    effect(() => {
      if (this.store() !== undefined) {
        untracked(() => void this.load());
      }
    });

    void this.start();

    inject(DestroyRef).onDestroy(() => {
      this.stopPolling();
      this.stopCollapsing();
      this.header.setActions(null);
      this.header.clear();
    });
  }

  protected search(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  protected filterHorizon(value: SelectValue): void {
    this.horizonQuery.set(value === '' ? '' : Number(value));
    this.page.set(1);
  }

  protected filterStatus(value: SelectValue): void {
    this.statusFilter.set(value as PlanStatus | '');
    this.page.set(1);
  }

  protected filterItemsRange(range: NumberRangeValue): void {
    this.itemsFrom.set(range.from);
    this.itemsTo.set(range.to);
    this.page.set(1);
  }

  protected filterCostRange(range: NumberRangeValue): void {
    this.costFrom.set(range.from);
    this.costTo.set(range.to);
    this.page.set(1);
  }

  protected filterDateRange(range: DateRangeValue): void {
    this.dateFrom.set(range.from);
    this.dateTo.set(range.to);
    this.page.set(1);
  }

  protected toggleSort(column: SortColumn): void {
    const order: SortDirection =
      this.sortColumn() === column
        ? this.sortDirection() === 'asc'
          ? 'desc'
          : 'asc'
        : column === 'name' || column === 'horizon' || column === 'status'
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

  protected open(plan: PurchasePlan): void {
    void this.router.navigate(['/purchases', plan.id]);
  }

  protected onCreated(plan: PurchasePlan): void {
    this.dialogOpen.set(false);
    void this.router.navigate(['/purchases', plan.id]);
  }

  protected async remove(plan: PurchasePlan): Promise<void> {
    const agreed = await this.confirm.ask({
      title: 'Удалить планировку?',
      message: `«${planTitle(plan)}» пропадёт из списка вместе с рассчитанными позициями.`,
      confirmLabel: 'Удалить',
      danger: true,
    });

    if (!agreed) {
      return;
    }

    try {
      await this.planning.remove(plan.id);
      this.plans.update((current) => current.filter((item) => item.id !== plan.id));
      this.toasts.success('Планировка удалена');
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось удалить планировку');
    }
  }

  private async start(): Promise<void> {
    if (this.umag.account() !== null) {
      return;
    }

    try {
      await this.umag.load();
    } catch (error) {
      if (this.umag.account() === null) {
        this.loading.set(false);
        this.toasts.error(error instanceof Error ? error.message : 'Не удалось открыть планировки');
      }
    }
  }

  private async load(): Promise<void> {
    const version = ++this.version;

    this.stopPolling();
    this.loading.set(true);
    this.plans.set([]);
    this.approved.set([]);
    this.query.set('');
    this.horizonQuery.set('');
    this.statusFilter.set('');
    this.itemsFrom.set('');
    this.itemsTo.set('');
    this.costFrom.set('');
    this.costTo.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
    this.page.set(1);
    this.sortColumn.set('time');
    this.sortDirection.set('desc');

    try {
      if (this.planning.account() === null) {
        await this.planning.load();
      }

      const [plans, approved] = await Promise.all([
        this.planning.plans(),
        this.planning.approved(),
      ]);

      if (version !== this.version) {
        return;
      }

      this.plans.set(plans);
      this.approved.set(approved);
      this.poll();
    } catch (error) {
      if (version !== this.version) {
        return;
      }

      this.toasts.error(error instanceof Error ? error.message : 'Не удалось открыть планировки');
    } finally {
      if (version === this.version) {
        this.loading.set(false);
      }
    }
  }

  private poll(): void {
    this.stopPolling();

    if (!this.plans().some((plan) => plan.status === 'building')) {
      return;
    }

    const version = this.version;

    this.pollTimer = setTimeout(async () => {
      try {
        const plans = await this.planning.plans();

        if (version !== this.version) {
          return;
        }

        this.plans.set(plans);
      } catch {
        // Сеть моргнула — попробуем на следующем круге.
      }

      this.poll();
    }, POLL_INTERVAL);
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

function comparePlans(first: PurchasePlan, second: PurchasePlan, column: SortColumn): number {
  if (column === 'name') {
    return planTitle(first).localeCompare(planTitle(second), 'ru');
  }

  if (column === 'horizon') {
    return first.horizon - second.horizon;
  }

  if (column === 'status') {
    return STATUS_ORDER[first.status] - STATUS_ORDER[second.status];
  }

  if (column === 'items') {
    return first.items_total - second.items_total;
  }

  if (column === 'cost') {
    return Number(first.total_cost) - Number(second.total_cost);
  }

  return first.created_at.localeCompare(second.created_at);
}

function dateKey(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/** Границы суммы: пустое или недописанное не участвует в фильтре. */
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
