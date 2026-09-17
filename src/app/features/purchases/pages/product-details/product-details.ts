import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Empty } from '../../../../shared/components/empty/empty';
import { Select, type SelectOption } from '../../../../shared/components/select/select';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { Spinner } from '../../../../shared/components/spinner/spinner';
import { Tabs } from '../../../../shared/components/tabs/tabs';
import { PageHeader } from '../../../../shared/services/page-header';
import { Toasts } from '../../../../shared/services/toasts';
import { Umag } from '../../../extensions/services/umag';
import { soldOf } from '../../components/chart-theme';
import { SalesForecastChart } from '../../components/sales-forecast-chart/sales-forecast-chart';
import { accuracyLabel, formatAmount, formatDate, formatError, formatTime } from '../../models/plan';
import { type StoreProductDetail, FORECAST_MODEL_IDS, forecastModelLabel } from '../../models/product';
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

/** С сервера всегда берём самый длинный хвост — короче режем уже на графике. */
const HISTORY_FETCH = 90;

const FORECAST_MODELS: SelectOption[] = [
  { value: 'auto', label: 'Авто' },
  ...FORECAST_MODEL_IDS.map((value) => ({ value, label: forecastModelLabel(value) })),
];

const HISTORY_USAGE: SelectOption[] = [
  { value: 'no', label: 'Без истории продаж' },
  { value: 'yes', label: 'С историей продаж' },
];

const BLOCK_TABS = ['Продажи', 'Прогноз'] as const;

/** Итоги по дневному ряду за выбранный период истории. */
interface PeriodStats {
  days: number;
  total: number;
  perDay: number;
  /** Прирост к прошлой неделе долей. Пусто — сравнивать не с чем. */
  trend: number | null;
}

/**
 * Карточка товара: сколько продали, когда последний раз и куда идёт спрос.
 */
@Component({
  selector: 'app-product-details',
  imports: [Empty, RouterLink, SalesForecastChart, Select, Spinner, StatCard, Tabs],
  templateUrl: './product-details.html',
})
export class ProductDetails {
  /** Штрихкод из `/products/:barcode`. */
  readonly barcode = input.required<string>();

  protected readonly formatAmount = formatAmount;
  protected readonly formatChange = formatChange;
  protected readonly formatDate = formatDate;
  protected readonly formatError = formatError;
  protected readonly formatTime = formatTime;
  protected readonly accuracyLabel = accuracyLabel;

  protected readonly horizons = HORIZONS;
  protected readonly historyOptions = HISTORY;
  protected readonly forecastModels = FORECAST_MODELS;
  protected readonly historyUsage = HISTORY_USAGE;
  protected readonly blockTabs = BLOCK_TABS;
  protected readonly blockTab = signal<string>('Продажи');

  protected readonly product = signal<StoreProductDetail | null>(null);
  protected readonly loading = signal(true);
  /** Перезапрос прогноза — крутим блок «К заказу». */
  protected readonly forecastLoading = signal(false);
  protected readonly missing = signal(false);
  protected readonly horizon = signal(14);
  protected readonly historyDays = signal(60);
  protected readonly forecastModel = signal('auto');
  protected readonly useSalesHistory = signal('no');

  private readonly planning = inject(Planning);
  private readonly umag = inject(Umag);
  private readonly header = inject(PageHeader);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);

  protected readonly connected = this.planning.connected;
  protected readonly forecast = computed(() => this.product()?.forecast ?? null);

  /** История на графике продаж: сервер отдаёт 90 дней, select оставляет хвост. */
  protected readonly shownHistory = computed(() => {
    const history = this.product()?.history ?? [];

    return history.slice(-this.historyDays());
  });

  /** Единица измерения с пробелом — подставляется к каждому количеству. */
  protected readonly unit = computed(() => {
    const measure = this.product()?.measure ?? '';

    return measure ? ` ${measure}` : '';
  });

  protected readonly stats = computed<PeriodStats | null>(() => {
    const values = this.shownHistory().map(soldOf);

    if (!values.length) {
      return null;
    }

    const lastWeek = sum(values.slice(-7));
    const previousWeek = values.length >= 14 ? sum(values.slice(-14, -7)) : null;
    const total = sum(values);

    return {
      days: values.length,
      total,
      perDay: total / values.length,
      trend: previousWeek ? lastWeek / previousWeek - 1 : null,
    };
  });

  protected readonly soldLabel = computed(() => {
    const stats = this.stats();

    return stats ? `Продано за ${stats.days} дн.` : 'Продано';
  });

  protected readonly needLabel = computed(() => `Нужно на ${this.horizon()} дн.`);

  /** Столько заказывают по плану, если на складе пусто: спрос плюс запас. */
  protected readonly need = computed(() => {
    const forecast = this.forecast();

    return forecast ? Number(forecast.quantity) + Number(forecast.safety_stock) : null;
  });

  /** Доля самого спроса в заказе — остальное занимает страховой запас. */
  protected readonly demandShare = computed(() => {
    const forecast = this.forecast();
    const need = this.need();

    return forecast && need ? (Number(forecast.quantity) / need) * 100 : 0;
  });

  /** Праздники в горизонте: на сколько они двигают спрос. Ровно — не двигают. */
  protected readonly holidayShift = computed(() => {
    const factor = Number(this.forecast()?.holiday_factor ?? 1);

    if (!Number.isFinite(factor) || Math.abs(factor - 1) < 0.01) {
      return null;
    }

    return formatChange(factor - 1);
  });

  private version = 0;
  private forecastSeq = 0;
  /** Какой прогноз уже лежит в карточке — повторно вкладку не дёргаем. */
  private forecastKey = '';

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
      untracked(() => void this.load(barcode));
    });

    effect(() => {
      this.blockTab();
      this.horizon();
      this.forecastModel();
      this.product()?.barcode;
      untracked(() => void this.loadForecast());
    });

    inject(DestroyRef).onDestroy(() => this.header.clear());
  }

  protected selectTab(tab: string): void {
    this.blockTab.set(tab);

    if (tab === 'Прогноз' && !this.forecast()) {
      this.forecastLoading.set(true);
    }
  }

  protected setHorizon(value: string | number): void {
    this.horizon.set(Number(value));
    this.forecastLoading.set(true);
  }

  protected setHistoryDays(value: string | number): void {
    this.historyDays.set(Number(value));
  }

  protected setForecastModel(value: string | number): void {
    this.forecastModel.set(String(value));
    this.forecastLoading.set(true);
  }

  protected setUseSalesHistory(value: string | number): void {
    this.useSalesHistory.set(String(value));
  }

  private async load(barcode: string): Promise<void> {
    const version = ++this.version;
    const keep = this.product()?.barcode === barcode;

    if (!keep) {
      this.loading.set(true);
      this.forecastLoading.set(false);
      this.product.set(null);
      this.forecastModel.set('auto');
      this.blockTab.set('Продажи');
      this.forecastKey = '';
      this.forecastSeq += 1;
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
          this.forecastLoading.set(false);
        }

        return;
      }

      const detail = await this.planning.product(
        barcode,
        this.horizon(),
        HISTORY_FETCH,
        undefined,
        false,
      );

      if (version !== this.version) {
        return;
      }

      this.product.set(detail);
      this.forecastKey = '';
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

  private async loadForecast(): Promise<void> {
    if (this.blockTab() !== 'Прогноз') {
      return;
    }

    const product = this.product();

    if (!product) {
      return;
    }

    const model = this.forecastModel();
    const key = `${product.barcode}:${this.horizon()}:${model}`;

    if (this.forecastKey === key) {
      this.forecastLoading.set(false);
      return;
    }

    const seq = ++this.forecastSeq;
    const version = this.version;
    this.forecastLoading.set(true);

    try {
      const detail = await this.planning.product(
        product.barcode,
        this.horizon(),
        HISTORY_FETCH,
        model === 'auto' ? undefined : model,
        true,
      );

      if (seq !== this.forecastSeq || version !== this.version) {
        return;
      }

      this.product.set(detail);
      this.forecastKey = key;
    } catch (error) {
      if (seq !== this.forecastSeq || version !== this.version) {
        return;
      }

      this.toasts.error(error instanceof Error ? error.message : 'Не удалось посчитать прогноз');
    } finally {
      if (seq === this.forecastSeq && version === this.version) {
        this.forecastLoading.set(false);
      }
    }
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Изменение долей — со знаком: «+12%», «−8%». */
function formatChange(value: number): string {
  const percent = Math.round(value * 100);

  return `${percent > 0 ? '+' : percent < 0 ? '−' : ''}${Math.abs(percent)}%`;
}
