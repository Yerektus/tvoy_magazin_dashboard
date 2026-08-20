import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Auth } from '../services/auth';

/** Пускает только с токеном, остальных — на /login с возвратом назад. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);

  return (
    auth.isAuthenticated() ||
    router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } })
  );
};

/**
 * Пускает к тому, чем ведут организацию: расширения, дальше настройки и люди.
 * Убрать пункт из меню мало — по прямому адресу страница открылась бы всё
 * равно, а на ней ждёт 403 от сервера вместо понятного экрана.
 */
export const managesOrganizationGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return auth.managesOrganization() || router.createUrlTree(['/documents']);
};

/** Не показывает форму входа тем, кто уже вошёл. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return !auth.isAuthenticated() || router.createUrlTree(['/documents']);
};
