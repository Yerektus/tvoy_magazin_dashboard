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
  BadgeCheck,
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
import { Confirm } from '../../../../shared/services/confirm';
import { PageHeader } from '../../../../shared/services/page-header';
import { Toasts } from '../../../../shared/services/toasts';
import { Umag } from '../../../extensions/services/umag';
import {
  type ApprovedPurchase,
  type ApprovedPurchaseItem,
  type PurchasePlan,
  type PurchasePlanItem,
  type SortMode,
  formatAmount,
  formatApprovedAt,
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

/** Сколько держим подпись на экране между появлением и исчезновением. */
const HINT_HOLD_MS = 3000;

/** Столько же длится `hint-in` и `hint-out` в `styles.css`. */
const HINT_FADE_MS = 400;

/** Столько же длится `accordion-out` в `styles.css`. */
const COLLAPSE_MS = 200;

/** Вкладки страницы и то, чем они оборачиваются. */
const TABS: Record<string, 'plan' | 'approved'> = {
  План: 'plan',
  Одобренные: 'approved',
};

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
  protected readonly approveIcon = BadgeCheck;
  protected readonly lowIcon = Clock;

  protected readonly periods = PERIODS;
  protected readonly sorts = SORTS;
  protected readonly horizons = HORIZONS;

  protected readonly formatAmount = formatAmount;
  protected readonly formatApprovedAt = formatApprovedAt;
  protected readonly formatCover = formatCover;
  protected readonly formatMoney = formatMoney;
  protected readonly isOut = isOut;

  protected readonly plan = signal<PurchasePlan | null>(null);
  protected readonly approved = signal<ApprovedPurchase[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  /** Отмена расчёта: кнопку не жмут дважды, пока запрос едет. */
  protected readonly cancelling = signal(false);
  /** Какого поставщика сейчас одобряют: у его кнопки крутится спиннер. */
  protected readonly approving = signal('');

  /** Порядок групп — дело показа, пересчёта он не требует. */
  protected readonly sort = signal<SortMode>('urgent');

  /** Настройки расчёта раскрываются кнопкой: в панели им тесно. */
  protected readonly filterOpen = signal(false);

  /** Что считать: до первого плана — по умолчанию, дальше — как посчитали. */
  protected readonly days = signal(30);
  protected readonly horizon = signal(14);

  private readonly planning = inject(Planning);
  private readonly umag = inject(Umag);
  private readonly header = inject(PageHeader);
  private readonly toasts = inject(Toasts);
  private readonly confirm = inject(Confirm);

  protected readonly connected = this.planning.connected;

  /**
   * Магазин, выбранный в шапке: план всегда по нему. `undefined` — про UMAG
   * ещё не спрашивали, и за планом рано: он приедет не тот, что нужен.
   */
  private readonly store = computed(() => this.umag.account()?.targetId);

  protected readonly tab = computed(() => TABS[this.header.activeTab() ?? ''] ?? 'plan');
  protected readonly onPlan = computed(() => this.tab() === 'plan');
  protected readonly onApproved = computed(() => this.tab() === 'approved');

  protected readonly items = computed<PurchasePlanItem[]>(() => this.plan()?.items ?? []);
  protected readonly building = computed(() => isBuilding(this.plan()));
  protected readonly failed = computed(() => this.plan()?.status === 'failed');
  protected readonly calculating = computed(() => this.building() || this.busy());

  /** Текущая подпись под спиннером: появляется, держится, исчезает. */
  protected readonly hint = signal('');
  protected readonly hintPhase = signal<'in' | 'out' | ''>('');

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

  protected readonly trackItem = (item: PurchasePlanItem | ApprovedPurchaseItem) => item.position;
  protected readonly trackApproved = (purchase: ApprovedPurchase) => purchase.id;

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
    this.header.setTabs(Object.keys(TABS));

    effect(() => {
      // Пока грузимся — connected ещё неизвестен, табы не прячем.
      const locked = !this.loading() && !this.connected();

      untracked(() => this.header.setTabs(locked ? [] : Object.keys(TABS)));
    });

    // Новый план — группы свёрнуты; раскрывает пользователь.
    effect(() => {
      if (!this.onPlan()) {
        return;
      }

      // Состав групп: новый план и смена магазина сбрасывают раскрытие.
      this.groups();
      this.stopCollapsing();
      this.opened.set(new Set());
    });

    // На одобренных — тоже свёрнуты, пока не раскроют.
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

    // Магазин переключают в шапке. Это другой план, а не другой вид того же,
    // поэтому страница загружается заново — с заглушками вместо старых строк.
    effect(() => {
      if (this.store() !== undefined) {
        untracked(() => void this.load());
      }
    });

    // Пока считается — крутим шаги под спиннером: появление → пауза → исчезновение.
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

    void this.start();

    inject(DestroyRef).onDestroy(() => {
      this.stopPolling();
      this.stopCollapsing();
      this.header.clear();
    });
  }

  /** Раскрывает и сворачивает группу поставщика. */
  protected toggle(key: string): void {
    this.clearCollapseTimer(key);

    if (!this.opened().has(key)) {
      this.closing.update((current) => without(current, key));
      this.opened.update((current) => added(current, key));
      return;
    }

    this.opened.update((current) => without(current, key));
    this.closing.update((current) => added(current, key));

    // Анимация доиграла — таблицу можно убирать из разметки.
    this.collapseTimers.set(
      key,
      setTimeout(() => {
        this.collapseTimers.delete(key);
        this.closing.update((current) => without(current, key));
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

  /** Бросает текущий расчёт: недосчитанный план на сервере удаляется. */
  protected async cancel(): Promise<void> {
    if (this.cancelling()) {
      return;
    }

    const version = ++this.version;

    this.stopPolling();
    this.cancelling.set(true);
    this.busy.set(false);
    this.plan.set(null);

    try {
      await this.planning.cancel();
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

  /** Что сейчас считает бэкенд — целыми фразами, по одному шагу. */
  private hintSteps(): string[] {
    const plan = this.plan();
    const days = plan?.days ?? this.days();
    const horizon = plan?.horizon ?? this.horizon();
    const store = plan?.store_name || this.umag.account()?.targetName || '';
    const where = store ? ` в «${store}»` : '';

    return [
      `Смотрим, что продавалось за период`,
      'Сверяем, сколько ещё осталось на полках',
      'Ищем, самые продаваемые позиции',
      `Считаем, чего не хватит ${forHorizon(horizon)}`,
    ];
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

  /** Одобряет закуп у поставщика: позиции уезжают во вкладку «Одобренные». */
  protected async approve(group: { supplier: string; items: PurchasePlanItem[] }): Promise<void> {
    if (this.approving() || this.busy() || this.building()) {
      return;
    }

    const supplier = group.items[0]?.supplier ?? '';
    const label = group.supplier;

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
      const purchase = await this.planning.approve(supplier);
      const plan = await this.planning.plan();

      this.plan.set(plan);
      this.approved.update((current) => [purchase, ...current]);
      this.toasts.success(`Одобрен закуп у «${label}»`);
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось одобрить закуп');
    } finally {
      this.approving.set('');
    }
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

      // Магазин переключили или расчёт бросили, пока считалось.
      if (version !== this.version) {
        await this.planning.cancel(plan.id).catch(() => undefined);
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

  /** Загружает план и одобренные выбранного магазина. */
  private async load(): Promise<void> {
    const version = ++this.version;

    this.stopPolling();
    this.loading.set(true);
    // Прошлый магазин закрываем сразу: его план к выбранному отношения не имеет.
    this.plan.set(null);
    this.approved.set([]);

    try {
      // Состояние расширения нужно, чтобы отличить «не подключено» от «нет плана».
      if (this.planning.account() === null) {
        await this.planning.load();
      }

      const [plan, approved] = await Promise.all([
        this.planning.plan(),
        this.planning.approved(),
      ]);

      // Магазин успели переключить — этот план уже никому не нужен.
      if (version !== this.version) {
        return;
      }

      this.plan.set(plan);
      this.approved.set(approved);

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

  private clearCollapseTimer(key: string): void {
    const timer = this.collapseTimers.get(key);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.collapseTimers.delete(key);
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

/** Период анализа — как говорят, а не «за 30 дней». */
function forPeriod(days: number): string {
  if (days === 7) {
    return 'за неделю';
  }

  if (days === 14) {
    return 'за две недели';
  }

  if (days === 30) {
    return 'за месяц';
  }

  if (days === 60) {
    return 'за два месяца';
  }

  return `за ${days} дней`;
}

/** Горизонт закупа — той же живой речью. */
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
