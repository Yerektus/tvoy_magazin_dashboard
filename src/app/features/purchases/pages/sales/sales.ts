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
import { Empty } from '../../../../shared/components/empty/empty';
import { Icon } from '../../../../shared/components/icon/icon';
import { Select, type SelectOption } from '../../../../shared/components/select/select';
import { Spinner } from '../../../../shared/components/spinner/spinner';
import { StatCard } from '../../../../shared/components/stat-card/stat-card';
import { PageHeader } from '../../../../shared/services/page-header';
import { Toasts } from '../../../../shared/services/toasts';
import { Umag } from '../../../extensions/services/umag';
import { soldOf } from '../../components/chart-theme';
import { SalesForecastChart } from '../../components/sales-forecast-chart/sales-forecast-chart';
import { emptyAnalytics, type SalesAnalytics } from '../../models/analytics';
import { formatAmount } from '../../models/plan';
import { Planning } from '../../services/planning';

const POLL_INTERVAL = 2500;

const PERIODS: SelectOption[] = [
  { value: 7, label: '7 дней' },
  { value: 30, label: '30 дней' },
  { value: 60, label: '60 дней' },
  { value: 90, label: '90 дней' },
];

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * Продажи магазина за период: график, дни недели и категории.
 */
@Component({
  selector: 'app-sales',
  imports: [Button, Empty, Icon, RouterLink, SalesForecastChart, Select, Spinner, StatCard],
  templateUrl: './sales.html',
})
export class Sales {
  protected readonly syncIcon = RefreshCw;
  protected readonly periods = PERIODS;
  protected readonly formatAmount = formatAmount;
  protected readonly formatChange = formatChange;
  protected readonly weekdayLabel = (weekday: number) => WEEKDAYS[weekday] ?? '';

  protected readonly snapshot = signal<SalesAnalytics>(emptyAnalytics());
  protected readonly days = signal(30);
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
  protected readonly weekdayMax = computed(() =>
    maxSold(this.snapshot().weekdays.map((row) => row.sold)),
  );
  protected readonly categoryMax = computed(() =>
    maxSold(this.snapshot().categories.map((row) => row.sold)),
  );

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

  protected setDays(value: string | number): void {
    this.days.set(Number(value));
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
    this.snapshot.set(emptyAnalytics(this.days()));

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
      const snapshot = await this.planning.analytics(this.days());

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
        const snapshot = await this.planning.analytics(this.days());

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
