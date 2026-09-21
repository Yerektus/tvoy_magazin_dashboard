import { type DailySold, type SalesSyncStatus } from './product';

/** День недели в сводке: 0 — понедельник. */
export interface AnalyticsWeekday {
  weekday: number;
  sold: string;
}

/** Час суток в сводке: 0–23 по местному времени чека. */
export interface AnalyticsHour {
  hour: number;
  sold: string;
}

/** Категория из номенклатуры: сколько SKU и какой объём. */
export interface AnalyticsCategory {
  name: string;
  sold: string;
  sku_count: number;
}

/** Сводка продаж выбранного магазина за окно дней. */
export interface SalesAnalytics {
  status: SalesSyncStatus;
  synced_at: string | null;
  history_from: string | null;
  error: string;
  has_sales: boolean;
  days: number;
  start: string;
  end: string;
  sold: string;
  sku_count: number;
  active_days: number;
  promo_share: string | null;
  trend: string | null;
  revenue: string | null;
  profit: string | null;
  visitors: number | null;
  average_check: string | null;
  revenue_trend: string | null;
  profit_trend: string | null;
  visitors_trend: string | null;
  average_check_trend: string | null;
  history: DailySold[];
  weekdays: AnalyticsWeekday[];
  hours: AnalyticsHour[];
  categories: AnalyticsCategory[];
}

export const emptyAnalytics = (days = 30): SalesAnalytics => ({
  status: 'idle',
  synced_at: null,
  history_from: null,
  error: '',
  has_sales: false,
  days,
  start: '',
  end: '',
  sold: '0',
  sku_count: 0,
  active_days: 0,
  promo_share: null,
  trend: null,
  revenue: null,
  profit: null,
  visitors: null,
  average_check: null,
  revenue_trend: null,
  profit_trend: null,
  visitors_trend: null,
  average_check_trend: null,
  history: [],
  weekdays: [],
  hours: [],
  categories: [],
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Период сводки из адреса. Пусто — страница сама возьмёт последние дни. */
export function readSalesRange(
  get: (key: string) => string | null,
): { from: string; to: string } | null {
  const from = isoDate(get('from'));
  const to = isoDate(get('to'));

  if (!from && !to) {
    return null;
  }

  if (from && to && from > to) {
    return { from: to, to: from };
  }

  return { from: from || to, to: to || from };
}

export function salesRangeParams(from: string, to: string): Record<string, string | null> {
  return {
    from: DATE.test(from) ? from : null,
    to: DATE.test(to) ? to : null,
  };
}

function isoDate(value: string | null): string {
  const text = (value ?? '').trim();
  return DATE.test(text) ? text : '';
}
