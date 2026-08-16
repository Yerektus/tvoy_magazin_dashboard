import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../../../shared/services/api-config';
import { type ExtensionAccount, type ExtensionProvider } from '../../extensions/models/extension';
import { type PurchasePlan } from '../models/plan';

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

  readonly account = this.state.asReadonly();
  /** Подключено — в меню появляется страница планирования. */
  readonly connected = computed(() => this.state()?.connected === true);

  async load(): Promise<ExtensionAccount> {
    return this.save(await this.request<Access>('get', 'access/'));
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

  /** Ставит пересчёт: бэкенд считает в фоне, страница опрашивает статус. */
  async rebuild(days: number, horizon: number): Promise<PurchasePlan> {
    return this.request<PurchasePlan>('post', 'plan/', { days, horizon });
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
