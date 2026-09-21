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
  /** Ожидание модели на тех же днях, что и продажи — линия поверх столбцов. */
  fitted?: DailySold[];
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

/** Фильтры таблицы товаров, которые живут в адресе страницы. */
export interface ProductFilters {
  q: string;
  barcode: string;
  lastFrom: string;
  lastTo: string;
  soldFrom: string;
  soldTo: string;
  accuracy: ('high' | 'medium' | 'low' | 'none')[];
}

const ACCURACY_LEVELS = new Set(['high', 'medium', 'low', 'none']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const QTY = /^\d+(\.\d+)?$/;

export const emptyProductFilters = (): ProductFilters => ({
  q: '',
  barcode: '',
  lastFrom: '',
  lastTo: '',
  soldFrom: '',
  soldTo: '',
  accuracy: [],
});

/** Читает фильтры из query-строки. Чужое и кривое отбрасываем. */
export function readProductFilters(get: (key: string) => string | null): ProductFilters {
  const lastFrom = isoDate(get('last_from'));
  const lastTo = isoDate(get('last_to'));
  const [from, to] = lastFrom && lastTo && lastFrom > lastTo ? [lastTo, lastFrom] : [lastFrom, lastTo];
  const soldFrom = qty(get('sold_from'));
  const soldTo = qty(get('sold_to'));
  const [low, high] =
    soldFrom && soldTo && Number(soldFrom) > Number(soldTo) ? [soldTo, soldFrom] : [soldFrom, soldTo];

  return {
    q: (get('q') ?? '').trim(),
    barcode: (get('barcode') ?? '').trim(),
    lastFrom: from,
    lastTo: to,
    soldFrom: low,
    soldTo: high,
    accuracy: accuracyList(get('accuracy')),
  };
}

/** Query-параметры для адреса: пустые ключи снимаем. */
export function productFilterParams(filters: ProductFilters): Record<string, string | null> {
  return {
    q: filters.q.trim() || null,
    barcode: filters.barcode.trim() || null,
    last_from: filters.lastFrom || null,
    last_to: filters.lastTo || null,
    sold_from: filters.soldFrom || null,
    sold_to: filters.soldTo || null,
    accuracy: filters.accuracy.length ? filters.accuracy.join(',') : null,
  };
}

export function sameProductFilters(left: ProductFilters, right: ProductFilters): boolean {
  return (
    left.q === right.q &&
    left.barcode === right.barcode &&
    left.lastFrom === right.lastFrom &&
    left.lastTo === right.lastTo &&
    left.soldFrom === right.soldFrom &&
    left.soldTo === right.soldTo &&
    left.accuracy.join(',') === right.accuracy.join(',')
  );
}

function isoDate(value: string | null): string {
  const text = (value ?? '').trim();
  return DATE.test(text) ? text : '';
}

function qty(value: string | null): string {
  const text = (value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  return QTY.test(text) ? text : '';
}

function accuracyList(value: string | null): ('high' | 'medium' | 'low' | 'none')[] {
  const found: ('high' | 'medium' | 'low' | 'none')[] = [];
  const seen = new Set<string>();

  for (const part of (value ?? '').split(',')) {
    const level = part.trim();

    if (ACCURACY_LEVELS.has(level) && !seen.has(level)) {
      seen.add(level);
      found.push(level as 'high' | 'medium' | 'low' | 'none');
    }
  }

  return found;
}

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
