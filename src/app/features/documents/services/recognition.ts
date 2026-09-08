import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../../../shared/services/api-config';
import { type ExtensionAccount, type ExtensionProvider } from '../../extensions/models/extension';

/** Что отвечает бэкенд про подключение расширения. */
interface Access {
  connected: boolean;
}

/**
 * Расширение «Распознавание документов».
 *
 * Своего входа у него нет: фото читает сервер, а подключение — отметка, что
 * организация этим пользуется. Накладные общие на смену, поэтому состояние
 * одно на всю организацию.
 */
@Injectable({ providedIn: 'root' })
export class Recognition implements ExtensionProvider {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE_URL}/invoices/`;

  private readonly state = signal<ExtensionAccount | null>(null);
  private readonly loadingState = signal(false);

  readonly account = this.state.asReadonly();
  /** Идёт первый запрос состояния — меню ещё не готово. */
  readonly loading = this.loadingState.asReadonly();
  /** Подключено — можно загружать фото и перезапускать разбор. */
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
