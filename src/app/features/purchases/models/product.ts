export type SalesSyncStatus = 'idle' | 'syncing' | 'ready' | 'failed';

/** Товар из продаж выбранного магазина. */
export interface StoreProduct {
  barcode: string;
  name: string;
  measure: string;
  sold: string;
  last_sold: string | null;
  forecast_error: string | null;
}

/** День на графике: сколько ушло с полки. На сводке магазина ещё и выручка. */
export interface DailySold {
  date: string;
  sold: string;
  revenue?: string | null;
}

/** Прогноз спроса на горизонт закупа. */
export interface ProductForecast {
  model: string;
  quantity: string;
  per_day: string;
  safety_stock: string;
  holiday_factor: string;
  error: string;
  observations: number;
  series: DailySold[];
}

/** Карточка товара: продажи и прогноз. */
export interface StoreProductDetail extends StoreProduct {
  supplier: string;
  horizon: number;
  history_days: number;
  history: DailySold[];
  forecast: ProductForecast | null;
}

/** Вкладка «Товары»: выгрузка чеков и одна страница списка. */
export interface ProductsSnapshot {
  status: SalesSyncStatus;
  synced_at: string | null;
  history_from: string | null;
  error: string;
  items_total: number;
  page: number;
  page_size: number;
  items: StoreProduct[];
}

/** Что спрашиваем у списка: поиск, сортировка и страница. */
export interface ProductsQuery {
  q?: string;
  barcode?: string;
  page?: number;
  pageSize?: number;
  sort?: 'name' | 'barcode' | 'sold' | 'last' | 'accuracy';
  order?: 'asc' | 'desc';
  lastFrom?: string;
  lastTo?: string;
  soldFrom?: string;
  soldTo?: string;
  accuracy?: ('high' | 'medium' | 'low' | 'none')[];
}

export const emptyProducts = (): ProductsSnapshot => ({
  status: 'idle',
  synced_at: null,
  history_from: null,
  error: '',
  items_total: 0,
  page: 1,
  page_size: 50,
  items: [],
});

const MODEL_LABELS: Record<string, string> = {
  average: 'Среднее',
  weighted_average: 'Сглаживание',
  weekly_average: 'Среднее по дням недели',
  holt: 'Хольт',
  holt_winters_weekly: 'Хольт–Винтерс',
  auto_ets: 'ETS (авто)',
  auto_theta: 'Theta (авто)',
  croston_sba: 'Кростон',
  seasonal_naive_week: 'Сезонный (неделя)',
  seasonal_naive_year: 'Сезонный (год)',
  pooled_weekly: 'С опорой на магазин',
};

export const FORECAST_MODEL_IDS = [
  'average',
  'weighted_average',
  'weekly_average',
  'holt',
  'holt_winters_weekly',
  'auto_ets',
  'auto_theta',
  'croston_sba',
  'seasonal_naive_week',
  'seasonal_naive_year',
  'pooled_weekly',
] as const;

/** Как назвать модель прогноза в карточке. */
export function forecastModelLabel(model: string): string {
  return MODEL_LABELS[model] ?? model;
}
