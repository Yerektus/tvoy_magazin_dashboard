import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import { Chart, ChartConfiguration, ChartData, TooltipItem } from 'chart.js/auto';

import { formatAmount } from '../../models/plan';
import { type DailySold } from '../../models/product';

const BLUE = '#2563EB';
const AMBER = '#D97706';
const GRID = '#F5F5F5';
const MUTED = '#A3A3A3';
const FONT = 'Inter Variable, Inter, system-ui, sans-serif';
const FORECAST_LABEL = 'Прогноз';

/**
 * График продаж: сплошная линия — факт, пунктир — прогноз.
 */
@Component({
  selector: 'app-sales-forecast-chart',
  templateUrl: './sales-forecast-chart.html',
})
export class SalesForecastChart {
  readonly history = input.required<readonly DailySold[]>();
  readonly forecast = input.required<readonly DailySold[]>();
  readonly measure = input('');

  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('chart');
  private chart: Chart<'line'> | undefined;

  protected readonly hasSales = computed(() => this.history().some((row) => soldOf(row) > 0));

  protected readonly empty = computed(() => {
    const historyLen = this.history().length;
    const forecastLen = this.hasSales() ? this.forecast().length : 0;

    return historyLen + forecastLen < 2;
  });

  protected readonly data = computed<ChartData<'line'>>(() => {
    const history = this.history();
    const lastHistory = history.at(-1);
    const showForecast = this.hasSales();
    const forecast = showForecast
      ? this.forecast().filter((row) => !lastHistory || row.date > lastHistory.date)
      : [];
    const labels = [...history.map((row) => row.date), ...forecast.map((row) => row.date)];

    const datasets: ChartData<'line'>['datasets'] = [
      {
        label: 'Факт',
        data: [
          ...history.map((row) => {
            const value = soldOf(row);

            return value > 0 ? value : null;
          }),
          ...forecast.map(() => null),
        ],
        borderColor: BLUE,
        backgroundColor: 'rgba(59, 130, 246, 0.12)',
        fill: false,
        spanGaps: true,
        tension: 0.25,
        pointRadius: 2,
        pointHoverRadius: 4,
        borderWidth: 2,
      },
    ];

    if (showForecast && forecast.length > 0) {
      datasets.push({
        label: FORECAST_LABEL,
        data: [
          ...history.slice(0, -1).map(() => null),
          ...(lastHistory ? [soldOf(lastHistory)] : []),
          ...forecast.map((row) => soldOf(row)),
        ],
        borderColor: AMBER,
        backgroundColor: 'transparent',
        fill: false,
        spanGaps: false,
        tension: 0.25,
        pointRadius: 2,
        pointHoverRadius: 4,
        borderWidth: 2,
        borderDash: [6, 4],
      });
    }

    return { labels, datasets };
  });

  constructor() {
    effect(() => {
      const canvas = this.canvas()?.nativeElement;
      const empty = this.empty();
      const data = this.data();
      const options = this.chartOptions();

      untracked(() => this.draw(canvas, empty, data, options));
    });

    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }

  private readonly chartOptions = computed<ChartConfiguration<'line'>['options']>(() => {
    const unit = this.measure();
    const labels = this.data().labels ?? [];

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => {
            if (item.dataset.label !== FORECAST_LABEL) {
              return true;
            }

            const value = item.parsed.y;

            return value !== null && value !== undefined && Number(value) > 0;
          },
          callbacks: {
            title: (items) => (items[0] ? formatDay(String(items[0].label)) : ''),
            label: (item: TooltipItem<'line'>) => {
              const value = formatAmount(String(item.parsed.y ?? ''));
              const suffix = unit ? ` ${unit}` : '';

              return `${item.dataset.label}: ${value}${suffix}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'category',
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: MUTED,
            font: { family: FONT, size: 11 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
            callback: (value) => formatDay(String(labels[Number(value)] ?? value)),
          },
        },
        y: {
          type: 'linear',
          beginAtZero: true,
          border: { display: false },
          grid: { color: GRID },
          ticks: {
            color: MUTED,
            font: { family: FONT, size: 11 },
            maxTicksLimit: 5,
            callback: (value) => formatAmount(String(value)),
          },
        },
      },
    };
  });

  private draw(
    canvas: HTMLCanvasElement | undefined,
    empty: boolean,
    data: ChartData<'line'>,
    options: ChartConfiguration<'line'>['options'],
  ): void {
    if (!canvas || empty) {
      this.chart?.destroy();
      this.chart = undefined;
      return;
    }

    if (this.chart) {
      this.chart.data = data;
      this.chart.options = options ?? {};
      this.chart.update('none');
      return;
    }

    this.chart = new Chart(canvas, { type: 'line', data, options });
  }
}

function soldOf(row: DailySold): number {
  const value = Number.parseFloat(String(row.sold ?? '').replace(',', '.'));

  return Number.isFinite(value) ? value : 0;
}

function formatDay(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
