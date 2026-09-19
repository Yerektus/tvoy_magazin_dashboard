import {
  Component,
  DestroyRef,
  ElementRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Chart, ChartConfiguration, ChartData, TooltipItem } from 'chart.js/auto';

import { formatAmount } from '../../models/plan';
import { BLUE, FONT, GRID, MUTED } from '../chart-theme';

const PX_PER_BAR = 56;
const AXIS_GUTTER = 48;
const MIN_CHART_WIDTH = 280;
/** Как Tailwind `sm`: на более широком экране график уже влезает без скролла. */
const SCROLL_QUERY = '(max-width: 639px)';

/**
 * Столбцы по подписям: часы суток или дни недели.
 */
@Component({
  selector: 'app-sales-bar-chart',
  templateUrl: './sales-bar-chart.html',
  host: { class: 'block min-w-0 max-w-full' },
})
export class SalesBarChart {
  readonly labels = input<readonly string[]>([]);
  readonly values = input<readonly number[]>([]);
  readonly titles = input<readonly string[]>([]);
  readonly caption = input('График');
  /** На телефоне не сжимать столбцы, а прокручивать — для 24 часов. */
  readonly scrollable = input(false, { transform: booleanAttribute });

  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('chart');
  private readonly compact = signal(window.matchMedia(SCROLL_QUERY).matches);
  private chart: Chart<'bar'> | undefined;

  protected readonly empty = computed(
    () => this.labels().length === 0 || this.values().every((value) => value <= 0),
  );

  /** На телефоне часы листаем, дни недели всегда вписываются в ширину. */
  protected readonly pans = computed(() => this.scrollable() && this.compact());

  protected readonly chartWidth = computed(() =>
    Math.max(this.labels().length * PX_PER_BAR + AXIS_GUTTER, MIN_CHART_WIDTH),
  );

  protected readonly data = computed<ChartData<'bar'>>(() => ({
    labels: [...this.labels()],
    datasets: [
      {
        data: [...this.values()],
        backgroundColor: BLUE,
        hoverBackgroundColor: '#3B91D4',
        borderRadius: 0,
        borderSkipped: false,
        categoryPercentage: 0.92,
        barPercentage: 1,
      },
    ],
  }));

  constructor() {
    const media = window.matchMedia(SCROLL_QUERY);
    const onViewport = () => this.compact.set(media.matches);

    media.addEventListener('change', onViewport);
    inject(DestroyRef).onDestroy(() => media.removeEventListener('change', onViewport));

    effect(() => {
      const canvas = this.canvas()?.nativeElement;
      const empty = this.empty();
      const data = this.data();
      const options = this.chartOptions();

      untracked(() => this.draw(canvas, empty, data, options));
    });

    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }

  private readonly chartOptions = computed<ChartConfiguration<'bar'>['options']>(() => {
    const titles = this.titles();
    const labels = this.labels();

    const pans = this.pans();

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      // touchmove у Chart.js перехватывает жест — тогда ленту часов не сдвинуть.
      events: pans
        ? ['mousemove', 'mouseout', 'click', 'touchend']
        : ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove', 'touchend'],
      interaction: { mode: 'index', intersect: pans },
      layout: { padding: { top: 8, right: 8 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: (items) => {
              const index = items[0]?.dataIndex;

              if (index === undefined) {
                return '';
              }

              return String(titles[index] ?? labels[index] ?? '');
            },
            label: (item: TooltipItem<'bar'>) => formatAmount(String(item.parsed.y ?? '')),
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
            autoSkip: false,
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
            callback: (value) => formatAmount(String(value)),
          },
        },
      },
    };
  });

  private draw(
    canvas: HTMLCanvasElement | undefined,
    empty: boolean,
    data: ChartData<'bar'>,
    options: ChartConfiguration<'bar'>['options'],
  ): void {
    if (!canvas || empty) {
      this.chart?.destroy();
      this.chart = undefined;
      return;
    }

    if (this.chart) {
      this.chart.data = data;
      this.chart.options = options ?? {};
      this.chart.resize();
      this.chart.update('none');
      return;
    }

    this.chart = new Chart(canvas, { type: 'bar', data, options });
    this.chart.update('none');
  }
}
