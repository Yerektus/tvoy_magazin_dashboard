import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Clock, LineChart, Package, Shield } from 'lucide';

import { Empty } from '../../../../shared/components/empty/empty';
import { Select, type SelectOption } from '../../../../shared/components/select/select';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { Spinner } from '../../../../shared/components/spinner/spinner';
import { PageHeader } from '../../../../shared/services/page-header';
import { Toasts } from '../../../../shared/services/toasts';
import { Umag } from '../../../extensions/services/umag';
import { SalesForecastChart } from '../../components/sales-forecast-chart/sales-forecast-chart';
import { formatAmount, formatDate, formatTime } from '../../models/plan';
import { type StoreProductDetail } from '../../models/product';
import { Planning } from '../../services/planning';

const HORIZONS: SelectOption[] = [
  { value: 7, label: 'Прогноз на неделю' },
  { value: 14, label: 'Прогноз на 2 недели' },
  { value: 30, label: 'Прогноз на месяц' },
];

const HISTORY: SelectOption[] = [
  { value: 30, label: 'История 30 дней' },
  { value: 60, label: 'История 60 дней' },
  { value: 90, label: 'История 90 дней' },
];

/**
 * Карточка товара: сколько продали, когда последний раз и куда идёт спрос.
 */
@Component({
  selector: 'app-product-details',
  imports: [Empty, RouterLink, SalesForecastChart, Select, Spinner, StatCard],
  templateUrl: './product-details.html',
})
export class ProductDetails {
  /** Штрихкод из `/products/:barcode`. */
  readonly barcode = input.required<string>();

  protected readonly soldIcon = Package;
  protected readonly lastSaleIcon = Clock;
  protected readonly forecastIcon = LineChart;
  protected readonly safetyStockIcon = Shield;

  protected readonly formatAmount = formatAmount;
  protected readonly formatDate = formatDate;
  protected readonly formatTime = formatTime;

  protected readonly horizons = HORIZONS;
  protected readonly historyOptions = HISTORY;

  protected readonly product = signal<StoreProductDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly missing = signal(false);
  protected readonly horizon = signal(14);
  protected readonly historyDays = signal(60);

  private readonly planning = inject(Planning);
  private readonly umag = inject(Umag);
  private readonly header = inject(PageHeader);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);

  protected readonly connected = this.planning.connected;
  protected readonly forecast = computed(() => this.product()?.forecast ?? null);

  private version = 0;

  constructor() {
    effect(() => {
      const product = this.product();
      this.header.setCrumbs([
        { label: 'Товары', route: '/products' },
        product
          ? { label: product.name }
          : this.missing()
            ? { label: 'Товар' }
            : { label: '', loading: true },
      ]);
    });

    effect(() => {
      const barcode = this.barcode();
      this.umag.account()?.targetId;
      this.horizon();
      this.historyDays();
      untracked(() => void this.load(barcode));
    });

    inject(DestroyRef).onDestroy(() => this.header.clear());
  }

  protected setHorizon(value: string | number): void {
    this.horizon.set(Number(value));
  }

  protected setHistoryDays(value: string | number): void {
    this.historyDays.set(Number(value));
  }

  private async load(barcode: string): Promise<void> {
    const version = ++this.version;
    const keep = this.product()?.barcode === barcode;

    if (!keep) {
      this.loading.set(true);
      this.product.set(null);
    }

    this.missing.set(false);

    try {
      if (this.umag.account() === null) {
        await this.umag.load();
      }

      if (this.planning.account() === null) {
        await this.planning.load();
      }

      if (!this.planning.connected()) {
        if (version === this.version) {
          this.loading.set(false);
        }

        return;
      }

      const detail = await this.planning.product(barcode, this.horizon(), this.historyDays());

      if (version !== this.version) {
        return;
      }

      this.product.set(detail);
    } catch (error) {
      if (version !== this.version) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Не удалось открыть товар';

      if (message.toLowerCase().includes('не найден')) {
        this.product.set(null);
        this.missing.set(true);
      } else {
        this.toasts.error(message);
        void this.router.navigateByUrl('/products');
      }
    } finally {
      if (version === this.version) {
        this.loading.set(false);
      }
    }
  }
}
