import { Component, computed, input } from '@angular/core';
import { Minus, TrendingDown, TrendingUp, type IconNode } from 'lucide';

import { Icon } from '../icon/icon';

/**
 * Сравнение с прошлым окном: зелёная пилюля вверх, красная вниз.
 */
@Component({
  selector: 'app-stat-trend',
  imports: [Icon],
  templateUrl: './stat-trend.html',
  host: { class: 'mt-2 block', '[hidden]': 'percent() === null' },
})
export class StatTrend {
  readonly value = input<string | number | null>(null);
  readonly caption = input('к прошлой неделе');

  protected readonly percent = computed(() => {
    const raw = this.value();

    if (raw === null || raw === '') {
      return null;
    }

    const amount = typeof raw === 'number' ? raw : Number(raw);

    return Number.isFinite(amount) ? Math.round(amount * 100) : null;
  });

  protected readonly absPercent = computed(() => Math.abs(this.percent() ?? 0));

  protected readonly icon = computed<IconNode>(() => {
    const amount = this.percent() ?? 0;

    if (amount > 0) {
      return TrendingUp;
    }

    if (amount < 0) {
      return TrendingDown;
    }

    return Minus;
  });

  protected readonly tone = computed(() => {
    const amount = this.percent() ?? 0;
    const base = 'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium';

    if (amount > 0) {
      return `${base} bg-emerald-50 text-emerald-700`;
    }

    if (amount < 0) {
      return `${base} bg-red-50 text-red-700`;
    }

    return `${base} bg-neutral-100 text-neutral-500`;
  });
}
