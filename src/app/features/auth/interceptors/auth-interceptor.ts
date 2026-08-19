import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { Auth } from '../services/auth';

/** Запросы, которые сами разбираются с токенами: обновлять их бессмысленно. */
const OWN_AUTH = ['/auth/login/', '/auth/refresh/', '/auth/logout/'];

/**
 * Подставляет Bearer-токен, а на 401 молча меняет протухший access по refresh
 * и повторяет запрос. Не вышло — выкидывает на /login.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const token = auth.token();

  const withToken = (request: HttpRequest<unknown>, value: string) =>
    request.clone({ setHeaders: { Authorization: `Bearer ${value}` } });

  return next(token ? withToken(request, token) : request).pipe(
    catchError((error: unknown) => {
      const expired =
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        token !== null &&
        !OWN_AUTH.some((path) => request.url.includes(path));

      if (!expired) {
        return throwError(() => error);
      }

      return from(auth.refresh()).pipe(
        switchMap((fresh) => {
          if (!fresh) {
            // Refresh тоже недействителен — сессия кончилась по-настоящему.
            void router.navigate(['/login']);
            return throwError(() => error);
          }

          return next(withToken(request, fresh));
        }),
      );
    }),
  );
};
