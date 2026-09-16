import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../../../shared/services/api-config';
import { type ExtensionAccount, type ExtensionProvider } from '../../extensions/models/extension';
import { type ApprovedPurchase, type PurchasePlan } from '../models/plan';
import {
  type ProductsQuery,
  type ProductsSnapshot,
  type StoreProductDetail,
} from '../models/product';

/** Что отвечает бэкенд про подключение расширения. */
interface Access {
  connected: boolean;
  /** Подключён ли сам UMAG: без него считать не по чему. */
  umag: boolean;
}

/**
 * Расширение «Планирование закупов».
 *
 * Своего входа у него нет — оно работает поверх подключённого UMAG, поэтому
 * подключение это просто отметка, что сотрудник им пользуется. Магазин берётся
 * тот, что выбран в шапке.
 */
@Injectable({ providedIn: 'root' })
export class Planning implements ExtensionProvider {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE_URL}/purchases/`;

  private readonly state = signal<ExtensionAccount | null>(null);
  private readonly loadingState = signal(false);

  readonly account = this.state.asReadonly();
  /** Идёт первый запрос состояния — меню ещё не готово. */
  readonly loading = this.loadingState.asReadonly();
  /** Подключено — в меню появляется страница планирования. */
  readonly connected = computed(() => this.state()?.connected === true);

  async load(): Promise<ExtensionAccount> {
    this.loadingState.set(true);

    try {
      return this.save(await this.request<Access>('get', 'access/'));
    } finally {
      this.loadingState.set(false);
    }
  }

  /** Логин с паролем не нужны: расширение включается одной кнопкой. */
  async connect(): Promise<ExtensionAccount> {
    return this.save(await this.request<Access>('post', 'access/', {}));
  }

  async disconnect(): Promise<void> {
    this.save(await this.request<Access>('delete', 'access/'));
  }

  /** Последний посчитанный план по выбранному магазину. Пусто — не считали. */
  async plan(): Promise<PurchasePlan | null> {
    return this.request<PurchasePlan | null>('get', 'plan/');
  }

  /** Планировки выбранного магазина — без позиций, для таблицы. */
  async plans(): Promise<PurchasePlan[]> {
    return this.request<PurchasePlan[]>('get', 'plans/');
  }

  /** Одна планировка со строками. */
  async planById(id: number): Promise<PurchasePlan> {
    return this.request<PurchasePlan>('get', `plans/${id}/`);
  }

  /** Ставит пересчёт: бэкенд считает в фоне, страница опрашивает статус. */
  async rebuild(
    days: number,
    horizon: number,
    name = '',
    useStock = true,
  ): Promise<PurchasePlan> {
    return this.request<PurchasePlan>('post', 'plan/', {
      days,
      horizon,
      name,
      use_stock: useStock,
    });
  }

  /** Считает ту же планировку заново: имя остаётся, строки пересобираются. */
  async recount(
    id: number,
    days: number,
    horizon: number,
    useStock = true,
  ): Promise<PurchasePlan> {
    return this.request<PurchasePlan>('post', `plans/${id}/`, {
      days,
      horizon,
      use_stock: useStock,
    });
  }

  /** Удаляет планировку целиком — и готовую, и считающуюся. */
  async remove(id: number): Promise<void> {
    await this.request<void>('delete', `plans/${id}/`);
  }

  /** Бросает недосчитанный план. Готовый не трогает. */
  async cancel(planId?: number): Promise<void> {
    const path = planId == null ? 'plan/' : `plan/?id=${planId}`;
    await this.request<void>('delete', path);
  }

  /** Одобряет закуп у поставщика: строки уезжают из плана в отдельную запись. */
  async approve(supplier: string, planId?: number): Promise<ApprovedPurchase> {
    return this.request<ApprovedPurchase>('post', 'plan/approve/', {
      supplier,
      ...(planId == null ? {} : { plan: planId }),
    });
  }

  /** Одобренные закупки выбранного магазина. */
  async approved(): Promise<ApprovedPurchase[]> {
    return this.request<ApprovedPurchase[]>('get', 'approved/');
  }

  /** Товары из продаж и состояние выгрузки чеков. */
  async products(query: ProductsQuery = {}): Promise<ProductsSnapshot> {
    return this.request<ProductsSnapshot>('get', `products/?${productsQuery(query)}`);
  }

  /** Карточка товара: дневные продажи. Прогноз — только если его запросили. */
  async product(
    barcode: string,
    horizon = 14,
    historyDays = 60,
    model?: string,
    forecast = true,
  ): Promise<StoreProductDetail> {
    const query = new URLSearchParams({
      horizon: String(horizon),
      history_days: String(historyDays),
      forecast: forecast ? 'true' : 'false',
    });

    if (model) {
      query.set('model', model);
    }

    return this.request<StoreProductDetail>(
      'get',
      `products/${encodeURIComponent(barcode)}/?${query}`,
    );
  }

  /** Забирает чеки из UMAG. Пока грузится — страница опрашивает `products()`. */
  async syncProducts(query: ProductsQuery = {}): Promise<ProductsSnapshot> {
    return this.request<ProductsSnapshot>('post', `products/?${productsQuery(query)}`, {});
  }

  private save(access: Access): ExtensionAccount {
    const account: ExtensionAccount = {
      connected: access.connected,
      login: '',
      targetId: null,
      targetName: '',
    };

    this.state.set(account);
    return account;
  }

  private async request<T>(
    method: 'get' | 'post' | 'delete',
    path: string,
    body?: unknown,
  ): Promise<T> {
    try {
      const url = `${this.url}${path}`;
      const call =
        method === 'get'
          ? this.http.get<T>(url)
          : method === 'delete'
            ? this.http.delete<T>(url)
            : this.http.post<T>(url, body);

      return await firstValueFrom(call);
    } catch (error) {
      throw new Error(describe(error));
    }
  }
}

function productsQuery(query: ProductsQuery): string {
  const params = new URLSearchParams();

  if (query.q) {
    params.set('q', query.q);
  }

  if (query.barcode) {
    params.set('barcode', query.barcode);
  }

  if (query.lastFrom) {
    params.set('last_from', query.lastFrom);
  }

  if (query.lastTo) {
    params.set('last_to', query.lastTo);
  }

  if (query.soldFrom) {
    params.set('sold_from', query.soldFrom);
  }

  if (query.soldTo) {
    params.set('sold_to', query.soldTo);
  }

  if (query.page) {
    params.set('page', String(query.page));
  }

  if (query.pageSize) {
    params.set('page_size', String(query.pageSize));
  }

  if (query.sort) {
    params.set('sort', query.sort);
  }

  if (query.order) {
    params.set('order', query.order);
  }

  return params.toString();
}

function describe(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Не удалось связаться с сервером';
  }

  if (error.status === 0) {
    return 'Сервер недоступен. Проверьте, запущен ли API.';
  }

  const detail = (error.error as { detail?: unknown } | null)?.detail;

  return typeof detail === 'string' && detail.trim() ? detail : `Ошибка сервера (${error.status})`;
}
