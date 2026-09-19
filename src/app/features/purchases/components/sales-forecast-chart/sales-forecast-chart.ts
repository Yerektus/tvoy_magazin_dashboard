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
import { Chart, ChartConfiguration, ChartData, Plugin, TooltipItem } from 'chart.js/auto';

import { formatAmount, formatMoney, isWholeMeasure, wholeDays } from '../../models/plan';
import { type DailySold } from '../../models/product';
import {
  AMBER,
  AMBER_RGB,
  BLUE,
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
 */
@Component({
  selector: 'app-sales-forecast-chart',
  templateUrl: './sales-forecast-chart.html',
  host: { class: 'block min-w-0' },
})
export class SalesForecastChart {
  readonly history = input<readonly DailySold[]>([]);
  readonly forecast = input<readonly DailySold[]>([]);
  readonly measure = input('');
  readonly money = input(false, { transform: booleanAttribute });

  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('chart');
  private chart: Chart<'line'> | undefined;

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

    if (this.showsFact() && this.showsForecast()) {
      return 'График продаж и прогноза';
    }

    return this.showsForecast() ? 'График прогноза' : 'График продаж';
  });

  protected readonly data = computed<ChartData<'line'>>(() => {
    const history = this.factDays();
    const forecast = this.forecastDays();
    const lastHistory = history.at(-1);
    const labels = [...history.map((row) => row.date), ...forecast.map((row) => row.date)];
    const datasets: ChartData<'line'>['datasets'] = [];

    if (history.length > 0) {
      const keepZero = this.money();

      datasets.push({
        label: FACT_LABEL,
        data: [
          ...history.map((row) => {
            const value = soldOf(row);

            return keepZero || value > 0 ? value : null;
          }),
          ...forecast.map(() => null),
        ],
        borderColor: BLUE,
        backgroundColor: fillColor(BLUE_RGB),
        pointBackgroundColor: BLUE,
        spanGaps: true,
        ...LINE,
      });
    }

    if (forecast.length > 0) {
      datasets.push({
        label: FORECAST_LABEL,
        data: history.length
          ? [
              ...history.slice(0, -1).map(() => null),
              ...(lastHistory ? [soldOf(lastHistory)] : []),
              ...forecast.map((row) => soldOf(row)),
            ]
          : forecast.map((row) => soldOf(row)),
        borderColor: history.length ? AMBER : BLUE,
        backgroundColor: fillColor(history.length ? AMBER_RGB : BLUE_RGB),
        pointBackgroundColor: history.length ? AMBER : BLUE,
        spanGaps: false,
        ...LINE,
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
    const historyLen = this.factDays().length;
    const money = this.money();

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

            // Точка стыка линий — это факт последнего дня, а не прогноз:
            // иначе подсказка на истории врёт «Прогноз: столько же».
            if (item.dataset.label === FORECAST_LABEL && item.dataIndex < historyLen) {
              return false;
            }

            if (item.dataset.label === FORECAST_LABEL && Number(value) <= 0) {
              return false;
            }

            return true;
          },
          callbacks: {
            title: (items) => (items[0] ? formatDay(String(items[0].label)) : ''),
            label: (item: TooltipItem<'line'>) => {
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
          offset: false,
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

    this.chart = new Chart(canvas, {
      type: 'line',
      data,
      options,
      plugins: [areaFillPlugin],
    });
    this.chart.update('none');
  }
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

const areaFillPlugin: Plugin<'line'> = {
  id: 'salesAreaFill',
  afterLayout(chart) {
    const area = chart.chartArea;

    if (!area) {
      return;
    }

    for (const dataset of chart.data.datasets) {
      const rgb =
        dataset.label === FORECAST_LABEL && chart.data.datasets.length > 1
          ? AMBER_RGB
          : BLUE_RGB;

      dataset.backgroundColor = makeGradient(chart.ctx, area, rgb);
    }
  },
};
