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
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, RefreshCw } from 'lucide';

import { Button } from '../../../../shared/components/button/button';
import {
  DateRange,
  type DateRangeValue,
} from '../../../../shared/components/date-range/date-range';
import {
  NumberRange,
  type NumberRangeValue,
} from '../../../../shared/components/number-range/number-range';
import { Empty } from '../../../../shared/components/empty/empty';
import { Icon } from '../../../../shared/components/icon/icon';
import { Select, type SelectValue } from '../../../../shared/components/select/select';
import { Spinner } from '../../../../shared/components/spinner/spinner';
import { Table } from '../../../../shared/components/table/table';
import { TableColumn } from '../../../../shared/components/table/table-column';
import { Toolbar } from '../../../../shared/components/toolbar/toolbar';
import { PageHeader } from '../../../../shared/services/page-header';
import { Toasts } from '../../../../shared/services/toasts';
import { Umag } from '../../../extensions/services/umag';
import {
  ACCURACY_FILTER_OPTIONS,
  type AccuracyLevel,
  accuracyClasses,
  accuracyIcon,
  accuracyLabel,
  formatAmount,
  formatDate,
  formatTime,
} from '../../models/plan';
import {
  type ProductsQuery,
  type ProductsSnapshot,
  type SalesSyncStatus,
  type StoreProduct,
  emptyProducts,
} from '../../models/product';
import { Planning } from '../../services/planning';

/** Пока чеки грузятся, список спрашиваем так же часто, как считающийся план. */
const POLL_INTERVAL = 2500;
/** Сколько строк на одной странице таблицы. */
const PAGE_SIZE = 50;
/** Поиск не бьёт API на каждую букву. */
const SEARCH_DELAY = 300;

type SortColumn = 'name' | 'barcode' | 'sold' | 'last' | 'accuracy';
type SortDirection = 'asc' | 'desc';

/**
 * Товары магазина из продаж UMAG. Синхронизация живёт здесь, а планировка
 * потом читает уже готовую копию.
 */
@Component({
  selector: 'app-products',
  imports: [
    Button,
    DateRange,
    Empty,
    Icon,
    NumberRange,
    RouterLink,
    Select,
    Spinner,
    Table,
    TableColumn,
    Toolbar,
  ],
  templateUrl: './products.html',
})
export class Products {
  protected readonly syncIcon = RefreshCw;
  protected readonly prevIcon = ChevronLeft;
  protected readonly nextIcon = ChevronRight;
  protected readonly sortUpIcon = ArrowUp;
  protected readonly sortDownIcon = ArrowDown;
  protected readonly formatAmount = formatAmount;
  protected readonly formatDate = formatDate;
  protected readonly formatTime = formatTime;
  protected readonly accuracyLabel = accuracyLabel;
  protected readonly accuracyIcon = accuracyIcon;
  protected readonly accuracyClasses = accuracyClasses;
  protected readonly accuracyOptions = ACCURACY_FILTER_OPTIONS;

  protected readonly products = signal<StoreProduct[]>([]);
  protected readonly total = signal(0);
  protected readonly status = signal<SalesSyncStatus>('idle');
  protected readonly error = signal('');
  protected readonly query = signal('');
  protected readonly barcodeQuery = signal('');
  protected readonly lastFrom = signal('');
  protected readonly lastTo = signal('');
  protected readonly soldFrom = signal('');
  protected readonly soldTo = signal('');
  protected readonly accuracyQuery = signal<AccuracyLevel[]>([]);
  protected readonly page = signal(1);
  protected readonly sortColumn = signal<SortColumn>('sold');
  protected readonly sortDirection = signal<SortDirection>('desc');
  protected readonly loading = signal(true);
  /** Страница или сортировка: спиннер в таблице, пока ответ не пришёл. */
  protected readonly pending = signal(false);

  protected readonly trackProduct = (product: StoreProduct) => product.barcode;

  private readonly planning = inject(Planning);
  private readonly umag = inject(Umag);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);
  private readonly header = inject(PageHeader);
  private readonly headerActions = viewChild<TemplateRef<unknown>>('headerActions');

  protected readonly connected = this.planning.connected;
  protected readonly syncing = computed(() => this.status() === 'syncing');
  protected readonly failed = computed(() => this.status() === 'failed');
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  /** Номер, который реально показываем: не уезжаем за конец списка. */
  protected readonly shownPage = computed(() => Math.min(this.page(), this.pageCount()));
  protected readonly rangeLabel = computed(() => {
    const total = this.total().toLocaleString('ru-RU');
    return `${this.rangeStart()}–${this.rangeEnd()} из ${total}`;
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
  /** В шапке или в фильтрах что-то введено — пустой ответ это «не нашлось». */
  protected readonly filtering = computed(
    () =>
      this.query().trim().length > 0 ||
      this.barcodeQuery().trim().length > 0 ||
      this.lastFrom().length > 0 ||
      this.lastTo().length > 0 ||
      this.soldFrom().length > 0 ||
      this.soldTo().length > 0 ||
      this.accuracyQuery().length > 0,
  );

  /**
   * Магазин из шапки: товары всегда по нему. `undefined` — про UMAG ещё не
   * спрашивали, и список рано грузить.
   */
  private readonly store = computed(() => this.umag.account()?.targetId);

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private version = 0;
  /** Какой запрос списка сейчас актуальный: старый ответ страницу не откатывает. */
  private seq = 0;

  constructor() {
    effect(() => {
      const actions = this.headerActions();
      const hasProducts = this.total() > 0 || this.filtering();
      this.header.setActions(
        this.connected() && !this.loading() && hasProducts && actions ? actions : null,
      );
    });

    effect(() => {
      if (this.store() !== undefined) {
        untracked(() => void this.load());
      }
    });

    void this.start();

    inject(DestroyRef).onDestroy(() => {
      this.stopPolling();
      this.stopSearch();
      this.header.setActions(null);
    });
  }

  protected search(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.scheduleRefresh();
  }

  protected searchBarcode(event: Event): void {
    this.barcodeQuery.set((event.target as HTMLInputElement).value);
    this.scheduleRefresh();
  }

  protected filterLastRange(range: DateRangeValue): void {
    this.lastFrom.set(range.from);
    this.lastTo.set(range.to);
    void this.refresh(this.version, { table: true, page: 1 });
  }

  protected filterSoldRange(range: NumberRangeValue): void {
    this.soldFrom.set(range.from);
    this.soldTo.set(range.to);
    void this.refresh(this.version, { table: true, page: 1 });
  }

  protected filterAccuracy(values: SelectValue[]): void {
    this.accuracyQuery.set(values as AccuracyLevel[]);
    this.scheduleRefresh();
  }

  protected toggleSort(column: SortColumn): void {
    const order: SortDirection =
      this.sortColumn() === column
        ? this.sortDirection() === 'asc'
          ? 'desc'
          : 'asc'
        : column === 'name' || column === 'barcode' || column === 'accuracy'
          ? 'asc'
          : 'desc';

    void this.refresh(this.version, { table: true, sort: column, order, page: 1 });
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

    void this.refresh(this.version, { table: true, page: next });
  }

  protected open(product: StoreProduct): void {
    void this.router.navigate(['/products', product.barcode]);
  }

  protected async sync(): Promise<void> {
    if (this.syncing()) {
      return;
    }

    this.status.set('syncing');
    this.error.set('');

    try {
      const query = this.listing();
      this.apply(await this.planning.syncProducts(query), query);
      this.poll();
    } catch (error) {
      this.status.set('failed');
      this.toasts.error(
        error instanceof Error ? error.message : 'Не удалось синхронизировать продажи',
      );
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
        this.toasts.error(error instanceof Error ? error.message : 'Не удалось открыть товары');
      }
    }
  }

  private async load(): Promise<void> {
    const version = ++this.version;

    this.stopPolling();
    this.stopSearch();
    this.loading.set(true);
    this.apply(emptyProducts());
    this.query.set('');
    this.barcodeQuery.set('');
    this.lastFrom.set('');
    this.lastTo.set('');
    this.soldFrom.set('');
    this.soldTo.set('');
    this.accuracyQuery.set([]);
    this.page.set(1);
    this.sortColumn.set('sold');
    this.sortDirection.set('desc');

    try {
      if (this.planning.account() === null) {
        await this.planning.load();
      }

      await this.refresh(version);
      this.poll();
    } catch (error) {
      if (version !== this.version) {
        return;
      }

      this.toasts.error(error instanceof Error ? error.message : 'Не удалось открыть товары');
    } finally {
      if (version === this.version) {
        this.loading.set(false);
      }
    }
  }

  private scheduleRefresh(): void {
    this.stopSearch();
    this.searchTimer = setTimeout(
      () => void this.refresh(this.version, { table: true, page: 1 }),
      SEARCH_DELAY,
    );
  }

  private stopSearch(): void {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  }

  private async refresh(
    version = this.version,
    options: ProductsQuery & { table?: boolean } = {},
  ): Promise<void> {
    this.stopSearch();

    const previous = {
      page: this.page(),
      sort: this.sortColumn(),
      order: this.sortDirection(),
    };
    const seq = ++this.seq;

    if (options.table) {
      this.pending.set(true);

      if (options.page != null) {
        this.page.set(options.page);
      }

      if (options.sort) {
        this.sortColumn.set(options.sort);
      }

      if (options.order) {
        this.sortDirection.set(options.order);
      }
    }

    const query = this.listing(options);

    try {
      const snapshot = await this.planning.products(query);

      if (seq !== this.seq || version !== this.version) {
        return;
      }

      this.apply(snapshot, query);

      if (options.page != null) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (error) {
      if (seq !== this.seq || version !== this.version) {
        return;
      }

      if (options.table) {
        this.page.set(previous.page);
        this.sortColumn.set(previous.sort);
        this.sortDirection.set(previous.order);
      }

      this.toasts.error(error instanceof Error ? error.message : 'Не удалось открыть товары');
    } finally {
      if (seq === this.seq && version === this.version && options.table) {
        this.pending.set(false);
      }
    }
  }

  private listing(overrides: ProductsQuery = {}): ProductsQuery {
    const lastFrom = overrides.lastFrom ?? this.lastFrom();
    const lastTo = overrides.lastTo ?? this.lastTo();
    const from = lastFrom && lastTo && lastFrom > lastTo ? lastTo : lastFrom;
    const to = lastFrom && lastTo && lastFrom > lastTo ? lastFrom : lastTo;
    const sold = orderedBounds(
      overrides.soldFrom ?? this.soldFrom(),
      overrides.soldTo ?? this.soldTo(),
    );

    return {
      q: overrides.q ?? this.query().trim(),
      barcode: overrides.barcode ?? this.barcodeQuery().trim(),
      page: overrides.page ?? this.page(),
      pageSize: PAGE_SIZE,
      sort: overrides.sort ?? this.sortColumn(),
      order: overrides.order ?? this.sortDirection(),
      lastFrom: from || undefined,
      lastTo: to || undefined,
      soldFrom: sold.from,
      soldTo: sold.to,
      accuracy: overrides.accuracy ?? this.accuracyQuery(),
    };
  }

  private poll(): void {
    this.stopPolling();

    if (!this.syncing()) {
      return;
    }

    const version = this.version;

    this.pollTimer = setTimeout(async () => {
      if (this.pending()) {
        this.poll();
        return;
      }

      const seq = this.seq;
      const query = this.listing();

      try {
        const snapshot = await this.planning.products(query);

        if (seq === this.seq && version === this.version) {
          this.apply(snapshot, query);
        }
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

  private apply(snapshot: ProductsSnapshot, requested?: ProductsQuery): void {
    if (this.stale(requested)) {
      this.status.set(snapshot.status);
      this.error.set(snapshot.error);
      return;
    }

    this.products.set(snapshot.items);
    this.total.set(snapshot.items_total);
    this.status.set(snapshot.status);
    this.error.set(snapshot.error);

    if (snapshot.page !== this.page()) {
      this.page.set(snapshot.page);
    }
  }

  private stale(requested?: ProductsQuery): boolean {
    if (requested == null) {
      return false;
    }

    return (
      (requested.page != null && requested.page !== this.page()) ||
      (requested.sort != null && requested.sort !== this.sortColumn()) ||
      (requested.order != null && requested.order !== this.sortDirection())
    );
  }
}

/** Границы количества: пустое или недописанное не уходит в запрос. */
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
