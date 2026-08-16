import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../../../shared/services/api-config';
import {
  type ExtensionAccount,
  type ExtensionProvider,
  type ExtensionTarget,
} from '../models/extension';
import {
  type UmagAccount,
  type UmagDraft,
  type UmagPreflight,
  type UmagStore,
} from '../models/umag';

/** Расширение UMAG: вход в кабинет и отправка накладных черновиком приёмки. */
@Injectable({ providedIn: 'root' })
export class Umag implements ExtensionProvider {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE_URL}/umag/`;

  private readonly state = signal<ExtensionAccount | null>(null);

  readonly account = this.state.asReadonly();
  /** Готовы отправлять: вход есть и магазин выбран. */
  readonly connected = computed(() => this.state()?.connected === true);

  /** Состояние подключения. Запрашивается один раз на загрузку страницы. */
  async load(): Promise<ExtensionAccount> {
    return this.save(await this.request<UmagAccount>('get', 'account/'));
  }

  /**
   * Пароль уходит на наш сервер, тот меняет его на токен и забывает.
   * `identityId` нужен, когда на номер заведено несколько сотрудников.
   */
  async connect(login: string, password: string, identityId?: number): Promise<ExtensionAccount> {
    return this.save(
      await this.request<UmagAccount>('post', 'account/', {
        phone: login,
        password,
        user_id: identityId ?? null,
      }),
    );
  }

  async targets(): Promise<ExtensionTarget[]> {
    return this.request<UmagStore[]>('get', 'stores/');
  }

  async chooseTarget(id: number): Promise<ExtensionAccount> {
    return this.save(await this.request<UmagAccount>('patch', 'account/', { store_id: id }));
  }

  async disconnect(): Promise<void> {
    await this.request<void>('delete', 'account/');
    this.state.set(null);
  }

  /** Что мешает отправить накладную: поставщик и каждая строка. */
  async preflight(invoiceId: number): Promise<UmagPreflight> {
    return this.request<UmagPreflight>('get', `invoices/${invoiceId}/`);
  }

  /** Создаёт черновик приёмки. `agentId` — выбранный человеком поставщик. */
  async push(invoiceId: number, agentId?: number): Promise<UmagDraft> {
    return this.request<UmagDraft>('post', `invoices/${invoiceId}/`, {
      agent_id: agentId ?? null,
    });
  }

  /** Ответ UMAG в общем виде: расширения различаются только названиями полей. */
  private save(account: UmagAccount): ExtensionAccount {
    const mapped: ExtensionAccount = {
      connected: account.connected,
      login: account.phone,
      targetId: account.store_id,
      targetName: account.store_name,
      targets: account.stores,
      identities: account.users,
    };

    this.state.set(mapped);
    return mapped;
  }

  private async request<T>(
    method: 'get' | 'post' | 'patch' | 'delete',
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
            : method === 'patch'
              ? this.http.patch<T>(url, body)
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
