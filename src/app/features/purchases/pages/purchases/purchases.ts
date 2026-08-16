import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
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
  sortGroups,
  isBuilding,
  isOut,
} from '../../models/plan';
import { Planning } from '../../services/planning';

/** Пока план считается, спрашиваем его так же часто, как статус накладной. */
const POLL_INTERVAL = 2500;

/** Столько же длится `accordion-out` в `styles.css`. */
const COLLAPSE_MS = 200;

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
    Empty,
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
  private readonly umag = inject(Umag);
  private readonly toasts = inject(Toasts);

  protected readonly connected = this.planning.connected;

  /**
   * Магазин, выбранный в шапке: план всегда по нему. `undefined` — про UMAG
   * ещё не спрашивали, и за планом рано: он приедет не тот, что нужен.
   */
  private readonly store = computed(() => this.umag.account()?.targetId);

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

  /** Те, у кого таблица уже сворачивается: она нужна, пока играет анимация. */
  private readonly closing = signal<ReadonlySet<string>>(new Set());

  /** Кого рисуем: раскрытые и те, что ещё закрываются. */
  protected readonly visible = computed(() => new Set([...this.opened(), ...this.closing()]));

  protected readonly trackItem = (item: PurchasePlanItem) => item.position;

  private readonly filter = viewChild<ElementRef<HTMLElement>>('filter');

  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  /** Таймеры сворачивания: по одному на группу, которая сейчас закрывается. */
  private readonly collapseTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Номер загрузки. Магазин успевают переключить дважды подряд, а ответы
   * приходят в своём порядке: чужой план на экран пускать нельзя.
   */
  private version = 0;

  constructor() {
    // Новый план — раскрываем первого поставщика: у него самое горящее.
    effect(() => {
      const [first] = this.groups();

      this.stopCollapsing();
      this.opened.set(first ? new Set([first.supplier]) : new Set());
    });

    // Магазин переключают в шапке. Это другой план, а не другой вид того же,
    // поэтому страница загружается заново — с заглушками вместо старых строк.
    effect(() => {
      if (this.store() !== undefined) {
        untracked(() => void this.load());
      }
    });

    void this.start();

    inject(DestroyRef).onDestroy(() => {
      this.stopPolling();
      this.stopCollapsing();
    });
  }

  /** Раскрывает и сворачивает группу поставщика. */
  protected toggle(supplier: string): void {
    this.clearCollapseTimer(supplier);

    if (!this.opened().has(supplier)) {
      this.closing.update((current) => without(current, supplier));
      this.opened.update((current) => added(current, supplier));
      return;
    }

    this.opened.update((current) => without(current, supplier));
    this.closing.update((current) => added(current, supplier));

    // Анимация доиграла — таблицу можно убирать из разметки.
    this.collapseTimers.set(
      supplier,
      setTimeout(() => {
        this.collapseTimers.delete(supplier);
        this.closing.update((current) => without(current, supplier));
      }, COLLAPSE_MS),
    );
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

    const version = this.version;

    this.busy.set(true);

    try {
      const plan = await this.planning.rebuild(this.days(), this.horizon());

      // Магазин переключили, пока считалось: страница уже грузит его план.
      if (version !== this.version) {
        return;
      }

      this.plan.set(plan);
      this.poll();
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось посчитать план');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Узнаёт выбранный магазин, если шапка ещё не успела: без него неизвестно,
   * чей план показывать, и страница осталась бы с заглушками навсегда.
   */
  private async start(): Promise<void> {
    if (this.umag.account() !== null) {
      return;
    }

    try {
      await this.umag.load();
    } catch (error) {
      // Шапка спрашивает то же самое: если у неё получилось, молчим.
      if (this.umag.account() === null) {
        this.loading.set(false);
        this.toasts.error(error instanceof Error ? error.message : 'Не удалось открыть план');
      }
    }
  }

  /** Загружает план выбранного магазина. Пока он едет, на странице заглушки. */
  private async load(): Promise<void> {
    const version = ++this.version;

    this.stopPolling();
    this.loading.set(true);
    // Прошлый магазин закрываем сразу: его план к выбранному отношения не имеет.
    this.plan.set(null);

    try {
      // Состояние расширения нужно, чтобы отличить «не подключено» от «нет плана».
      if (this.planning.account() === null) {
        await this.planning.load();
      }

      const plan = await this.planning.plan();

      // Магазин успели переключить — этот план уже никому не нужен.
      if (version !== this.version) {
        return;
      }

      this.plan.set(plan);

      if (plan) {
        this.days.set(plan.days);
        this.horizon.set(plan.horizon);
      }

      this.poll();
    } catch (error) {
      if (version !== this.version) {
        return;
      }

      this.toasts.error(error instanceof Error ? error.message : 'Не удалось открыть план');
    } finally {
      if (version === this.version) {
        this.loading.set(false);
      }
    }
  }

  /** Пока план считается, спрашиваем его снова. */
  private poll(): void {
    this.stopPolling();

    if (!this.building()) {
      return;
    }

    const version = this.version;

    this.pollTimer = setTimeout(async () => {
      try {
        const plan = await this.planning.plan();

        // Пока спрашивали, магазин сменили: этот ответ уже про чужой план.
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

  private clearCollapseTimer(supplier: string): void {
    const timer = this.collapseTimers.get(supplier);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.collapseTimers.delete(supplier);
    }
  }

  /** Новый план или уход со страницы — досматривать анимации некому. */
  private stopCollapsing(): void {
    for (const timer of this.collapseTimers.values()) {
      clearTimeout(timer);
    }

    this.collapseTimers.clear();
    this.closing.set(new Set());
  }
}

/** Множество в сигнале меняем копией: правку на месте он не заметит. */
function added(current: ReadonlySet<string>, value: string): ReadonlySet<string> {
  return new Set(current).add(value);
}

function without(current: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(current);
  next.delete(value);

  return next;
}
