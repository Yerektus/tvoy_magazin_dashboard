export type SalesSyncStatus = 'idle' | 'syncing' | 'ready' | 'failed';

/** Товар из продаж выбранного магазина. */
export interface StoreProduct {
  barcode: string;
  name: string;
  measure: string;
  sold: string;
  last_sold: string | null;
}

/** Вкладка «Товары»: выгрузка чеков и список, собранный по ним. */
export interface ProductsSnapshot {
  status: SalesSyncStatus;
  synced_at: string | null;
  history_from: string | null;
  error: string;
  items_total: number;
  items: StoreProduct[];
}

export const emptyProducts = (): ProductsSnapshot => ({
  status: 'idle',
  synced_at: null,
  history_from: null,
  error: '',
  items_total: 0,
  items: [],
});
