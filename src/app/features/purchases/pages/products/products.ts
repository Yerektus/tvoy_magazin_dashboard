import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RefreshCw } from 'lucide';

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
  protected readonly formatAmount = formatAmount;
  protected readonly formatDate = formatDate;
  protected readonly formatTime = formatTime;

  protected readonly products = signal<StoreProduct[]>([]);
  protected readonly status = signal<SalesSyncStatus>('idle');
  protected readonly syncedAt = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly query = signal('');
  protected readonly loading = signal(true);

  protected readonly trackProduct = (product: StoreProduct) => product.barcode;

  private readonly planning = inject(Planning);
  private readonly umag = inject(Umag);
  private readonly toasts = inject(Toasts);

  protected readonly connected = this.planning.connected;
  protected readonly syncing = computed(() => this.status() === 'syncing');
  protected readonly failed = computed(() => this.status() === 'failed');
  protected readonly visible = computed(() => {
    const query = this.query().trim().toLowerCase();
    const items = this.products();

    if (!query) {
      return items;
    }

    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(query) || item.barcode.toLowerCase().includes(query),
    );
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
    this.syncedAt.set(snapshot.synced_at);
    this.error.set(snapshot.error);
  }
}
