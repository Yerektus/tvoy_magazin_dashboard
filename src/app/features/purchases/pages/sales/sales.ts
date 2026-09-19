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
import { RouterLink } from '@angular/router';
import { RefreshCw } from 'lucide';

import { Button } from '../../../../shared/components/button/button';
import {
  DateRange,
  type DateRangeValue,
} from '../../../../shared/components/date-range/date-range';
import { Empty } from '../../../../shared/components/empty/empty';
import { Icon } from '../../../../shared/components/icon/icon';
import { Spinner } from '../../../../shared/components/spinner/spinner';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { PageHeader } from '../../../../shared/services/page-header';
import { Toasts } from '../../../../shared/services/toasts';
import { Umag } from '../../../extensions/services/umag';
import { soldOf } from '../../components/chart-theme';
import { SalesBarChart } from '../../components/sales-bar-chart/sales-bar-chart';
import { SalesForecastChart } from '../../components/sales-forecast-chart/sales-forecast-chart';
import { emptyAnalytics, type SalesAnalytics } from '../../models/analytics';
import { formatAmount, formatMoney } from '../../models/plan';
import { Planning } from '../../services/planning';

const POLL_INTERVAL = 2500;
const DEFAULT_DAYS = 30;

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * Продажи магазина за период: график, часы, дни недели и категории.
 */
@Component({
  selector: 'app-sales',
  imports: [
    Button,
    DateRange,
    Empty,
    Icon,
    RouterLink,
    SalesBarChart,
    SalesForecastChart,
    Spinner,
    StatCard,
  ],
  templateUrl: './sales.html',
  host: { class: 'block min-w-0' },
})
export class Sales {
  protected readonly syncIcon = RefreshCw;
  protected readonly formatAmount = formatAmount;
  protected readonly formatMoney = formatMoney;
  protected readonly formatChange = formatChange;

  protected readonly snapshot = signal<SalesAnalytics>(emptyAnalytics());
  protected readonly from = signal(isoDaysAgo(DEFAULT_DAYS));
  protected readonly to = signal(isoToday());
  protected readonly loading = signal(true);
  protected readonly pending = signal(false);

  private readonly planning = inject(Planning);
  private readonly umag = inject(Umag);
  private readonly toasts = inject(Toasts);
  private readonly header = inject(PageHeader);
  private readonly headerActions = viewChild<TemplateRef<unknown>>('headerActions');

  protected readonly connected = this.planning.connected;
  protected readonly status = computed(() => this.snapshot().status);
  protected readonly error = computed(() => this.snapshot().error);
  protected readonly hasSales = computed(() => this.snapshot().has_sales);
  protected readonly syncing = computed(() => this.status() === 'syncing');
  protected readonly failed = computed(() => this.status() === 'failed');
  protected readonly hourLabels = computed(() =>
    this.snapshot().hours.map((row) => String(row.hour)),
  );
  protected readonly hourValues = computed(() => amounts(this.snapshot().hours));
  protected readonly hourTitles = computed(() =>
    this.snapshot().hours.map((row) => hourRange(row.hour)),
  );
  protected readonly weekdayLabels = computed(() =>
    this.snapshot().weekdays.map((row) => WEEKDAYS[row.weekday] ?? ''),
  );
  protected readonly weekdayValues = computed(() => amounts(this.snapshot().weekdays));
  protected readonly categoryMax = computed(() =>
    maxSold(this.snapshot().categories.map((row) => row.sold)),
  );
  protected readonly revenueHistory = computed(() => {
    const rows = this.snapshot().history;

    if (rows.every((row) => row.revenue == null || row.revenue === '')) {
      return [];
    }

    return rows.map((row) => ({ date: row.date, sold: row.revenue ?? '0' }));
  });

  /**
   * Магазин из шапки: сводка всегда по нему. `undefined` — про UMAG ещё не
   * спрашивали, и грузить рано.
   */
  private readonly store = computed(() => this.umag.account()?.targetId);

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private version = 0;
  private seq = 0;

  constructor() {
    effect(() => {
      const actions = this.headerActions();
      this.header.setActions(
        this.connected() && !this.loading() && this.hasSales() && actions ? actions : null,
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
      this.header.setActions(null);
    });
  }

  protected setRange(range: DateRangeValue): void {
    if (!range.from && !range.to) {
      this.from.set(isoDaysAgo(DEFAULT_DAYS));
      this.to.set(isoToday());
    } else {
      this.from.set(range.from);
      this.to.set(range.to);
    }

    void this.refresh(this.version, { pending: true });
  }

  protected share(value: string, max: number): number {
    const amount = soldOf({ date: '', sold: value });

    return max > 0 ? (amount / max) * 100 : 0;
  }

  protected formatShare(value: string | null): string {
    if (value === null) {
      return '—';
    }

    return formatChange(value, false);
  }

  protected async sync(): Promise<void> {
    if (this.syncing()) {
      return;
    }

    this.snapshot.update((current) => ({ ...current, status: 'syncing', error: '' }));

    try {
      await this.planning.syncProducts();
      await this.refresh(this.version);
      this.poll();
    } catch (error) {
      this.snapshot.update((current) => ({ ...current, status: 'failed' }));
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
        this.toasts.error(error instanceof Error ? error.message : 'Не удалось открыть продажи');
      }
    }
  }

  private async load(): Promise<void> {
    const version = ++this.version;

    this.stopPolling();
    this.loading.set(true);
    this.snapshot.set(emptyAnalytics(spanDays(this.from(), this.to())));

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

      this.toasts.error(error instanceof Error ? error.message : 'Не удалось открыть продажи');
    } finally {
      if (version === this.version) {
        this.loading.set(false);
      }
    }
  }

  private async refresh(
    version = this.version,
    options: { pending?: boolean } = {},
  ): Promise<void> {
    const seq = ++this.seq;

    if (options.pending) {
      this.pending.set(true);
    }

    try {
      const snapshot = await this.planning.analytics(this.from(), this.to());

      if (seq !== this.seq || version !== this.version) {
        return;
      }

      this.snapshot.set(snapshot);
    } catch (error) {
      if (seq !== this.seq || version !== this.version) {
        return;
      }

      this.toasts.error(error instanceof Error ? error.message : 'Не удалось открыть продажи');
    } finally {
      if (seq === this.seq && version === this.version && options.pending) {
        this.pending.set(false);
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
      if (this.pending()) {
        this.poll();
        return;
      }

      try {
        const snapshot = await this.planning.analytics(this.from(), this.to());

        if (version === this.version) {
          this.snapshot.set(snapshot);
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
}

function maxSold(values: readonly string[]): number {
  return values.reduce((max, value) => Math.max(max, soldOf({ date: '', sold: value })), 0);
}

function amounts(rows: readonly { sold: string }[]): number[] {
  return rows.map((row) => soldOf({ date: '', sold: row.sold }));
}

function hourRange(hour: number): string {
  const stamp = `${String(hour).padStart(2, '0')}`;

  return `${stamp}:00–${stamp}:59`;
}

/** Доля или прирост: «12%», «+12%», «−8%». */
function formatChange(value: string | number | null, signed = true): string {
  if (value === null || value === '') {
    return '—';
  }

  const amount = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(amount)) {
    return '—';
  }

  const percent = Math.round(amount * 100);

  if (!signed) {
    return `${Math.abs(percent)}%`;
  }

  return `${percent > 0 ? '+' : percent < 0 ? '−' : ''}${Math.abs(percent)}%`;
}

function isoToday(): string {
  return toIsoDate(new Date());
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - (days - 1));
  return toIsoDate(date);
}

function spanDays(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
