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
import { BLUE, BLUE_FILL, BLUE_HOVER, FONT, GRID, LABEL } from '../chart-theme';

const LABEL_WIDTH = 16;

/**
 * Паутина по категориям: чем дальше от центра, тем больше продали.
 */
@Component({
  selector: 'app-sales-radar-chart',
  templateUrl: './sales-radar-chart.html',
  host: { class: 'block min-w-0' },
})
export class SalesRadarChart {
  readonly labels = input<readonly string[]>([]);
  readonly values = input<readonly number[]>([]);
  readonly caption = input('График');

  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('chart');
  private chart: Chart<'radar'> | undefined;

  /** Без значений паутина пустая — тогда показываем заглушку, как у столбцов. */
  protected readonly empty = computed(
    () => this.labels().length === 0 || this.values().every((value) => value <= 0),
  );

  protected readonly data = computed<ChartData<'radar'>>(() => ({
    labels: [...this.labels()],
    datasets: [
      {
        data: [...this.values()],
        backgroundColor: BLUE_FILL,
        borderColor: BLUE,
        borderWidth: 2,
        pointBackgroundColor: BLUE,
        pointBorderColor: BLUE,
        pointHoverBackgroundColor: BLUE_HOVER,
        pointHoverBorderColor: BLUE_HOVER,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBorderWidth: 0,
      },
    ],
  }));

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

  private readonly chartOptions = computed<ChartConfiguration<'radar'>['options']>(() => {
    const labels = this.labels();
    const peak = Math.max(0, ...this.values());

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: 8 },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: (items) => {
              const index = items[0]?.dataIndex;
              return index === undefined ? '' : String(labels[index] ?? '');
            },
            label: (item: TooltipItem<'radar'>) => formatAmount(String(item.parsed.r ?? '')),
          },
        },
      },
      scales: {
        r: {
          beginAtZero: true,
          min: 0,
          ...(peak > 0 ? { max: peak } : {}),
          grid: { color: GRID },
          angleLines: { color: GRID },
          ticks: {
            display: false,
            count: 5,
          },
          pointLabels: {
            color: LABEL,
            font: { family: FONT, size: 11 },
            padding: 10,
            callback: (label) => wrapLabel(String(label)),
          },
        },
      },
    };
  });

  private draw(
    canvas: HTMLCanvasElement | undefined,
    empty: boolean,
    data: ChartData<'radar'>,
    options: ChartConfiguration<'radar'>['options'],
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

    this.chart = new Chart(canvas, { type: 'radar', data, options });
    this.chart.update('none');
  }
}

/** Длинное имя категории иначе наезжает на соседние оси. */
function wrapLabel(text: string): string | string[] {
  if (text.length <= LABEL_WIDTH) {
    return text;
  }

  const words = text.split(/\s+/).filter(Boolean);

  if (words.length === 1) {
    const lines: string[] = [];

    for (let index = 0; index < text.length; index += LABEL_WIDTH) {
      lines.push(text.slice(index, index + LABEL_WIDTH));
    }

    return lines;
  }

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length > LABEL_WIDTH && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}
