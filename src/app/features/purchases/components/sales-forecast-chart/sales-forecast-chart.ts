import {
  Component,
  DestroyRef,
  ElementRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import {
  Chart,
  ChartConfiguration,
  ChartData,
  ChartType,
  Plugin,
  TooltipItem,
} from 'chart.js/auto';

import { formatAmount, formatMoney, isWholeMeasure, wholeDays } from '../../models/plan';
import { type DailySold } from '../../models/product';
import {
  AMBER,
  AMBER_RGB,
  BLUE,
  BLUE_BAR,
  BLUE_BAR_HOVER,
  BLUE_RGB,
  FONT,
  GRID,
  MUTED,
  type Rgb,
  formatDay,
  soldOf,
} from '../chart-theme';

const FACT_LABEL = 'Факт';
const FORECAST_LABEL = 'Прогноз';

const LINE = {
  fill: 'origin' as const,
  tension: 0,
  pointRadius: 0,
  pointHoverRadius: 4,
  pointBorderColor: '#fff',
  pointBorderWidth: 2,
  borderWidth: 2,
};

/** На телефоне день не сжимаем: график шире экрана, его листают. */
const PX_PER_DAY = 16;
const MIN_CHART_WIDTH = 480;
const PX_PER_TICK = 80;

/**
 * Линейный график: факт, прогноз или оба ряда — смотря что передали.
 * С историей продаж факт — столбцы, прогноз — линия поверх, включая ожидание на прошлом.
 */
@Component({
  selector: 'app-sales-forecast-chart',
  templateUrl: './sales-forecast-chart.html',
  host: { class: 'block min-w-0' },
})
export class SalesForecastChart {
  readonly history = input<readonly DailySold[]>([]);
  readonly forecast = input<readonly DailySold[]>([]);
  /** Ожидание модели на днях продаж — без него линия начинается только с горизонта. */
  readonly fitted = input<readonly DailySold[]>([]);
  readonly measure = input('');
  readonly money = input(false, { transform: booleanAttribute });

  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('chart');
  private chart: Chart | undefined;
  private kind: ChartType | undefined;

  protected readonly factDays = computed(() => this.history());

  protected readonly forecastDays = computed(() => {
    const lastHistory = this.history().at(-1);
    const rows = this.forecast().filter((row) => !lastHistory || row.date > lastHistory.date);

    if (!isWholeMeasure(this.measure()) || rows.length === 0) {
      return rows;
    }

    const counts = wholeDays(rows.map(soldOf));

    return rows.map((row, index) => ({ ...row, sold: String(counts[index] ?? 0) }));
  });

  protected readonly showsFact = computed(() => this.factDays().length > 0);
  protected readonly showsForecast = computed(() => this.forecastDays().length > 0);
  protected readonly overlay = computed(() => this.showsFact() && this.showsForecast());

  protected readonly empty = computed(
    () => this.factDays().length + this.forecastDays().length < 2,
  );

  protected readonly chartWidth = computed(() =>
    Math.max(
      (this.factDays().length + this.forecastDays().length) * PX_PER_DAY,
      MIN_CHART_WIDTH,
    ),
  );

  protected readonly caption = computed(() => {
    if (this.money()) {
      return 'График выручки';
    }

    if (this.overlay()) {
      return 'График продаж и прогноза';
    }

    return this.showsForecast() ? 'График прогноза' : 'График продаж';
  });

  protected readonly data = computed<ChartData>(() => {
    const history = this.factDays();
    const forecast = this.forecastDays();
    const overlay = this.overlay();
    const labels = [...history.map((row) => row.date), ...forecast.map((row) => row.date)];
    const datasets: ChartData['datasets'] = [];

    if (history.length > 0) {
      const keepZero = this.money();
      const values = [
        ...history.map((row) => {
          const value = soldOf(row);

          return keepZero || value > 0 ? value : overlay ? 0 : null;
        }),
        ...forecast.map(() => null),
      ];

      if (overlay) {
        datasets.push({
          type: 'bar',
          label: FACT_LABEL,
          data: values,
          backgroundColor: BLUE_BAR,
          hoverBackgroundColor: BLUE_BAR_HOVER,
          borderRadius: 0,
          borderSkipped: false,
          categoryPercentage: 0.72,
          barPercentage: 0.9,
          maxBarThickness: 28,
          order: 2,
        });
      } else {
        datasets.push({
          label: FACT_LABEL,
          data: values,
          borderColor: BLUE,
          backgroundColor: fillColor(BLUE_RGB),
          pointBackgroundColor: BLUE,
          spanGaps: true,
          ...LINE,
        });
      }
    }

    if (forecast.length > 0) {
      const color = history.length ? AMBER : BLUE;
      const rgb = history.length ? AMBER_RGB : BLUE_RGB;

      datasets.push({
        label: FORECAST_LABEL,
        data: forecastLine(history, forecast, this.fitted()),
        borderColor: color,
        backgroundColor: overlay ? color : fillColor(rgb),
        pointBackgroundColor: color,
        spanGaps: true,
        ...LINE,
        ...(overlay ? { type: 'line' as const, fill: false, order: 1 } : {}),
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
      const overlay = this.overlay();

      untracked(() => this.draw(canvas, empty, data, options, overlay));
    });

    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }

  private readonly chartOptions = computed<ChartConfiguration['options']>(() => {
    const unit = this.measure();
    const labels = this.data().labels ?? [];
    const historyLen = this.factDays().length;
    const money = this.money();
    const overlay = this.overlay();

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 8, right: 8 } },
      elements: {
        line: { borderJoinStyle: 'round', borderCapStyle: 'round' },
        point: { hitRadius: 10 },
      },
      plugins: {
        legend: { display: false },
        filler: { propagate: false },
        tooltip: {
          filter: (item) => {
            const value = item.parsed.y;

            if (value === null || value === undefined) {
              return false;
            }

            // Без наложения точка стыка линий — это факт, а не прогноз.
            if (!overlay && item.dataset.label === FORECAST_LABEL && item.dataIndex < historyLen) {
              return false;
            }

            if (!overlay && item.dataset.label === FORECAST_LABEL && Number(value) <= 0) {
              return false;
            }

            return true;
          },
          callbacks: {
            title: (items) => (items[0] ? formatDay(String(items[0].label)) : ''),
            label: (item: TooltipItem<ChartType>) => {
              if (money) {
                return formatMoney(String(item.parsed.y ?? ''));
              }

              const value = formatAmount(String(item.parsed.y ?? ''), unit);
              const suffix = unit ? ` ${unit}` : '';

              return `${item.dataset.label}: ${value}${suffix}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'category',
          offset: overlay,
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: MUTED,
            font: { family: FONT, size: 11 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: Math.max(4, Math.round(this.chartWidth() / PX_PER_TICK)),
            callback: (value) => formatDay(String(labels[Number(value)] ?? value)),
          },
        },
        y: {
          type: 'linear',
          beginAtZero: true,
          border: { display: false },
          grid: { color: GRID, drawTicks: false },
          ticks: {
            color: MUTED,
            font: { family: FONT, size: 11 },
            maxTicksLimit: 5,
            ...(isWholeMeasure(unit) ? { precision: 0 } : {}),
            callback: (value) => {
              if (money) {
                return formatMoney(String(value));
              }

              const number = Number(value);

              if (isWholeMeasure(unit) && !Number.isInteger(number)) {
                return '';
              }

              return formatAmount(String(value), unit);
            },
          },
        },
      },
    };
  });

  private draw(
    canvas: HTMLCanvasElement | undefined,
    empty: boolean,
    data: ChartData,
    options: ChartConfiguration['options'],
    overlay: boolean,
  ): void {
    const kind: ChartType = 'line';

    if (!canvas || empty) {
      this.chart?.destroy();
      this.chart = undefined;
      this.kind = undefined;
      return;
    }

    if (this.chart && this.kind !== kind) {
      this.chart.destroy();
      this.chart = undefined;
    }

    if (this.chart) {
      this.chart.data = data;
      this.chart.options = options ?? {};
      this.chart.update('none');
      return;
    }

    this.kind = kind;
    this.chart = new Chart(canvas, {
      type: kind,
      data,
      options,
      plugins: [areaFillPlugin],
    });
    this.chart.update('none');
  }
}

function forecastLine(
  history: readonly DailySold[],
  forecast: readonly DailySold[],
  fitted: readonly DailySold[],
): (number | null)[] {
  if (!history.length) {
    return forecast.map(soldOf);
  }

  const byDate = new Map(fitted.map((row) => [row.date, soldOf(row)]));

  if (byDate.size > 0) {
    return [
      ...history.map((row) => (byDate.has(row.date) ? (byDate.get(row.date) ?? 0) : null)),
      ...forecast.map((row) => soldOf(row)),
    ];
  }

  const lastHistory = history.at(-1);

  return [
    ...history.slice(0, -1).map(() => null),
    lastHistory ? soldOf(lastHistory) : null,
    ...forecast.map((row) => soldOf(row)),
  ];
}

function fillColor(rgb: Rgb): string {
  const [r, g, b] = rgb;

  return `rgba(${r}, ${g}, ${b}, 0.12)`;
}

function makeGradient(
  ctx: CanvasRenderingContext2D,
  area: { top: number; bottom: number },
  rgb: Rgb,
): CanvasGradient {
  const [r, g, b] = rgb;
  const gradient = ctx.createLinearGradient(0, area.top, 0, area.bottom);

  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.32)`);
  gradient.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, 0.1)`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

  return gradient;
}

const areaFillPlugin: Plugin = {
  id: 'salesAreaFill',
  afterLayout(chart) {
    const area = chart.chartArea;

    if (!area) {
      return;
    }

    for (const dataset of chart.data.datasets) {
      const fill = 'fill' in dataset ? dataset.fill : undefined;

      if (dataset.type === 'bar' || fill === false) {
        continue;
      }

      const rgb =
        dataset.label === FORECAST_LABEL && chart.data.datasets.length > 1
          ? AMBER_RGB
          : BLUE_RGB;

      dataset.backgroundColor = makeGradient(chart.ctx, area, rgb);
    }
  },
};
