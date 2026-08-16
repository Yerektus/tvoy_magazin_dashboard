import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ArrowDownWideNarrow,
  Check,
  ChevronRight,
  Clock,
  RefreshCw,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide';

import { Button } from '../../../../shared/components/button/button';
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
import { Toasts } from '../../../../shared/services/toasts';
import {
  type PurchasePlan,
  type PurchasePlanItem,
  type SortMode,
  formatAmount,
  formatCover,
  formatMoney,
  groupBySupplier,
  sortGroups,
  isBuilding,
  isOut,
} from '../../models/plan';
import { Planning } from '../../services/planning';

/** Пока план считается, спрашиваем его так же часто, как статус накладной. */
const POLL_INTERVAL = 2500;

// Подписи внутри самих пунктов: в панели над таблицей ярлыкам сбоку места нет,
// а «Месяц» без пояснения ни о чём не говорит.

/** За какой период смотрим расход. */
const PERIODS: SelectOption[] = [
  { value: 7, label: 'Расход за неделю' },
  { value: 14, label: 'Расход за 2 недели' },
  { value: 30, label: 'Расход за месяц' },
  { value: 60, label: 'Расход за 2 месяца' },
];

/** Чем упорядочить поставщиков в списке. */
const SORTS: SelectOption[] = [
  { value: 'urgent', label: 'Сначала горящие' },
  { value: 'cost', label: 'Сначала крупные' },
  { value: 'name', label: 'По названию' },
];

/** На сколько дней закупаемся. */
const HORIZONS: SelectOption[] = [
  { value: 3, label: 'Закуп на 3 дня' },
  { value: 7, label: 'Закуп на неделю' },
  { value: 14, label: 'Закуп на 2 недели' },
  { value: 30, label: 'Закуп на месяц' },
];

/**
 * Планирование закупов: что заканчивается на полке и сколько дозаказать.
 * Считает бэкенд по товарному отчёту UMAG, страница показывает и пересчитывает.
 */
@Component({
  selector: 'app-purchases',
  imports: [
    Button,
    Icon,
    Menu,
    MenuItem,
    MenuTrigger,
    RouterLink,
    Select,
    Spinner,
    Table,
    TableColumn,
    Toolbar,
  ],
  templateUrl: './purchases.html',
  host: {
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'filterOpen.set(false)',
  },
})
export class Purchases {
  protected readonly retryIcon = RefreshCw;
  protected readonly openIcon = ChevronRight;
  protected readonly outIcon = TriangleAlert;
  protected readonly filterIcon = SlidersHorizontal;
  protected readonly sortIcon = ArrowDownWideNarrow;
  protected readonly chosenIcon = Check;
  protected readonly lowIcon = Clock;

  protected readonly periods = PERIODS;
  protected readonly sorts = SORTS;
  protected readonly horizons = HORIZONS;

  protected readonly formatAmount = formatAmount;
  protected readonly formatCover = formatCover;
  protected readonly formatMoney = formatMoney;
  protected readonly isOut = isOut;

  protected readonly plan = signal<PurchasePlan | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);

  /** Порядок групп — дело показа, пересчёта он не требует. */
  protected readonly sort = signal<SortMode>('urgent');

  /** Настройки расчёта раскрываются кнопкой: в панели им тесно. */
  protected readonly filterOpen = signal(false);

  /** Что считать: до первого плана — по умолчанию, дальше — как посчитали. */
  protected readonly days = signal(30);
  protected readonly horizon = signal(14);

  private readonly planning = inject(Planning);
  private readonly toasts = inject(Toasts);

  protected readonly connected = this.planning.connected;

  protected readonly items = computed<PurchasePlanItem[]>(() => this.plan()?.items ?? []);
  protected readonly building = computed(() => isBuilding(this.plan()));

  /** Чем считали — одной строкой, пока настройки свёрнуты. */
  protected readonly settings = computed(() => {
    const period = PERIODS.find((item) => item.value === this.days())?.label ?? '';
    const horizon = HORIZONS.find((item) => item.value === this.horizon())?.label ?? '';

    return `${period} · ${horizon.toLowerCase()}`;
  });

  /** Закупаются поставщиками — по ним же и раскладываем план. */
  protected readonly groups = computed(() =>
    sortGroups(groupBySupplier(this.items()), this.sort()),
  );

  /**
   * Раскрытые поставщики. Таблицу рисуем только у них: позиций в плане под
   * тысячу, и держать их все в разметке незачем.
   */
  protected readonly opened = signal<ReadonlySet<string>>(new Set());

  protected readonly trackItem = (item: PurchasePlanItem) => item.position;

  private readonly filter = viewChild<ElementRef<HTMLElement>>('filter');

  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Новый план — раскрываем первого поставщика: у него самое горящее.
    effect(() => {
      const [first] = this.groups();
      this.opened.set(first ? new Set([first.supplier]) : new Set());
    });

    void this.load();

    inject(DestroyRef).onDestroy(() => this.stopPolling());
  }

  protected toggled(supplier: string, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;

    this.opened.update((current) => {
      const next = new Set(current);

      if (open) {
        next.add(supplier);
      } else {
        next.delete(supplier);
      }

      return next;
    });
  }

  /** Клик мимо меню настроек закрывает его. */
  protected onDocumentPointerDown(event: Event): void {
    const target = event.target as Node | null;

    if (this.filterOpen() && target && !this.filter()?.nativeElement.contains(target)) {
      this.filterOpen.set(false);
    }
  }

  /** Пересчитывает с выбранными настройками и закрывает меню. */
  protected async apply(): Promise<void> {
    this.filterOpen.set(false);
    await this.rebuild();
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

  /** Считает план заново: бэкенд идёт в UMAG, страница ждёт результата. */
  protected async rebuild(): Promise<void> {
    if (this.busy()) {
      return;
    }

    this.busy.set(true);

    try {
      this.plan.set(await this.planning.rebuild(this.days(), this.horizon()));
      this.poll();
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось посчитать план');
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      // Состояние расширения нужно, чтобы отличить «не подключено» от «нет плана».
      if (this.planning.account() === null) {
        await this.planning.load();
      }

      const plan = await this.planning.plan();
      this.plan.set(plan);

      if (plan) {
        this.days.set(plan.days);
        this.horizon.set(plan.horizon);
      }

      this.poll();
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось открыть план');
    } finally {
      this.loading.set(false);
    }
  }

  /** Пока план считается, спрашиваем его снова. */
  private poll(): void {
    this.stopPolling();

    if (!this.building()) {
      return;
    }

    this.pollTimer = setTimeout(async () => {
      try {
        this.plan.set(await this.planning.plan());
      } catch {
        // Сеть моргнула — попробуем на следующем круге.
      }

      this.announce();
      this.poll();
    }, POLL_INTERVAL);
  }

  /** Пересчёт закончился — говорим чем, молча заканчиваться он не должен. */
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
