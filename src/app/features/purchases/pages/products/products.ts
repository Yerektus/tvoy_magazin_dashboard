import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, RefreshCw } from 'lucide';

import { Button } from '../../../../shared/components/button/button';
import { Empty } from '../../../../shared/components/empty/empty';
import { Icon } from '../../../../shared/components/icon/icon';
import { Spinner } from '../../../../shared/components/spinner/spinner';
import { Table } from '../../../../shared/components/table/table';
import { TableColumn } from '../../../../shared/components/table/table-column';
import { Toolbar } from '../../../../shared/components/toolbar/toolbar';
import { Toasts } from '../../../../shared/services/toasts';
import { Umag } from '../../../extensions/services/umag';
import { formatAmount, formatDate, formatTime } from '../../models/plan';
import {
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

type SortColumn = 'name' | 'sold' | 'last';
type SortDirection = 'asc' | 'desc';

/**
 * Товары магазина из продаж UMAG. Синхронизация живёт здесь, а планировка
 * потом читает уже готовую копию.
 */
@Component({
  selector: 'app-products',
  imports: [Button, Empty, Icon, RouterLink, Spinner, Table, TableColumn, Toolbar],
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

  protected readonly products = signal<StoreProduct[]>([]);
  protected readonly status = signal<SalesSyncStatus>('idle');
  protected readonly error = signal('');
  protected readonly query = signal('');
  protected readonly page = signal(1);
  protected readonly sortColumn = signal<SortColumn>('sold');
  protected readonly sortDirection = signal<SortDirection>('desc');
  protected readonly loading = signal(true);

  protected readonly trackProduct = (product: StoreProduct) => product.barcode;

  private readonly planning = inject(Planning);
  private readonly umag = inject(Umag);
  private readonly toasts = inject(Toasts);

  protected readonly connected = this.planning.connected;
  protected readonly syncing = computed(() => this.status() === 'syncing');
  protected readonly failed = computed(() => this.status() === 'failed');
  /** Отбор по поиску, затем сортировка — пагинация режет уже это. */
  protected readonly matched = computed(() => {
    const query = this.query().trim().toLowerCase();
    const items = query
      ? this.products().filter(
          (item) =>
            item.name.toLowerCase().includes(query) || item.barcode.toLowerCase().includes(query),
        )
      : this.products();

    return sortProducts(items, this.sortColumn(), this.sortDirection());
  });
  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.matched().length / PAGE_SIZE)),
  );
  /** Номер, который реально показываем: не уезжаем за конец списка. */
  protected readonly shownPage = computed(() => Math.min(this.page(), this.pageCount()));
  protected readonly rangeLabel = computed(() => {
    const total = this.matched().length.toLocaleString('ru-RU');
    return `${this.rangeStart()}–${this.rangeEnd()} из ${total}`;
  });
  protected readonly rangeStart = computed(() => {
    if (!this.matched().length) {
      return 0;
    }

    return (this.shownPage() - 1) * PAGE_SIZE + 1;
  });
  protected readonly rangeEnd = computed(() =>
    Math.min(this.shownPage() * PAGE_SIZE, this.matched().length),
  );
  protected readonly visible = computed(() => {
    const start = (this.shownPage() - 1) * PAGE_SIZE;
    return this.matched().slice(start, start + PAGE_SIZE);
  });

  /**
   * Магазин из шапки: товары всегда по нему. `undefined` — про UMAG ещё не
   * спрашивали, и список рано грузить.
   */
  private readonly store = computed(() => this.umag.account()?.targetId);

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private version = 0;

  constructor() {
    effect(() => {
      if (this.store() !== undefined) {
        untracked(() => void this.load());
      }
    });

    void this.start();

    inject(DestroyRef).onDestroy(() => this.stopPolling());
  }

  protected search(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  protected toggleSort(column: SortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set(column === 'name' ? 'asc' : 'desc');
    }

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

  protected async sync(): Promise<void> {
    if (this.syncing()) {
      return;
    }

    this.status.set('syncing');
    this.error.set('');

    try {
      this.apply(await this.planning.syncProducts());
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
    this.loading.set(true);
    this.apply(emptyProducts());
    this.query.set('');
    this.page.set(1);
    this.sortColumn.set('sold');
    this.sortDirection.set('desc');

    try {
      if (this.planning.account() === null) {
        await this.planning.load();
      }

      const snapshot = await this.planning.products();

      if (version !== this.version) {
        return;
      }

      this.apply(snapshot);
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

  private poll(): void {
    this.stopPolling();

    if (!this.syncing()) {
      return;
    }

    const version = this.version;

    this.pollTimer = setTimeout(async () => {
      try {
        const snapshot = await this.planning.products();

        if (version !== this.version) {
          return;
        }

        this.apply(snapshot);
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

  private apply(snapshot: ProductsSnapshot): void {
    this.products.set(snapshot.items);
    this.status.set(snapshot.status);
    this.error.set(snapshot.error);
  }
}

function sortProducts(
  items: readonly StoreProduct[],
  column: SortColumn,
  direction: SortDirection,
): StoreProduct[] {
  const factor = direction === 'asc' ? 1 : -1;

  return [...items].sort((left, right) => {
    switch (column) {
      case 'name':
        return factor * left.name.localeCompare(right.name, 'ru');
      case 'sold':
        return factor * (Number(left.sold) - Number(right.sold));
      case 'last': {
        const leftDate = left.last_sold ?? '';
        const rightDate = right.last_sold ?? '';
        return factor * leftDate.localeCompare(rightDate);
      }
    }
  });
}
