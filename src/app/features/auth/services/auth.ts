import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../../../shared/services/api-config';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
}

interface LoginResponse {
  access: string;
  user: AuthUser;
}

const TOKEN_KEY = 'tm.access';
const USER_KEY = 'tm.user';

@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);

  private readonly accessToken = signal<string | null>(localStorage.getItem(TOKEN_KEY));
  private readonly currentUser = signal<AuthUser | null>(restoreUser());

  readonly user = this.currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this.accessToken() !== null);

  token(): string | null {
    return this.accessToken();
  }

  /** Вход по почте и паролю. Бросает `Error` с текстом для пользователя. */
  async login(email: string, password: string): Promise<void> {
    let response: LoginResponse;

    try {
      response = await firstValueFrom(
        this.http.post<LoginResponse>(`${API_BASE_URL}/auth/login/`, {
          email: email.trim(),
          password,
        }),
      );
    } catch (error) {
      throw new Error(describe(error));
    }

    this.accessToken.set(response.access);
    this.currentUser.set(response.user);
    localStorage.setItem(TOKEN_KEY, response.access);
    localStorage.setItem(USER_KEY, JSON.stringify(response.user));
  }

  logout(): void {
    this.accessToken.set(null);
    this.currentUser.set(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
}

function restoreUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

/** Ответ DRF → сообщение на русском. */
function describe(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Не удалось войти. Попробуйте ещё раз.';
  }

  if (error.status === 0) {
    return 'Сервер недоступен. Проверьте, запущен ли API.';
  }

  if (error.status === 400 || error.status === 401) {
    return fieldError(error.error) ?? 'Неверная почта или пароль.';
  }

  if (error.status === 429) {
    return 'Слишком много попыток входа. Подождите немного.';
  }

  return fieldError(error.error) ?? 'Ошибка сервера. Попробуйте позже.';
}

function fieldError(body: unknown): string | null {
  if (typeof body === 'string' && body.trim()) {
    return body;
  }

  if (!body || typeof body !== 'object') {
    return null;
  }

  const payload = body as Record<string, unknown>;

  for (const key of ['detail', 'non_field_errors', 'email', 'password']) {
    const value = payload[key];

    if (typeof value === 'string' && value.trim()) {
      return value;
    }

    if (Array.isArray(value) && typeof value[0] === 'string') {
      return value[0];
    }
  }

  return null;
}
