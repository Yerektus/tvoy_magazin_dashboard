import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Recognition } from '../../documents/services/recognition';
import { Planning } from '../../purchases/services/planning';
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

  return auth.managesOrganization() || router.createUrlTree(['/']);
};

/** Не показывает форму входа тем, кто уже вошёл. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return !auth.isAuthenticated() || router.createUrlTree(['/']);
};

/**
 * Стартовая страница — первый раздел, который сейчас есть в меню.
 *
 * Документы и закупки появляются только после подключения расширения.
 * Иначе после входа человек оказался бы на странице, которой в сайдбаре нет.
 */
export const homeGuard: CanActivateFn = async () => {
  const recognition = inject(Recognition);
  const planning = inject(Planning);
  const auth = inject(Auth);
  const router = inject(Router);

  if (recognition.account() === null) {
    await recognition.load().catch(() => undefined);
  }

  if (recognition.connected()) {
    return router.createUrlTree(['/documents']);
  }

  if (planning.account() === null) {
    await planning.load().catch(() => undefined);
  }

  if (planning.connected()) {
    return router.createUrlTree(['/purchases']);
  }

  return router.createUrlTree(auth.managesOrganization() ? ['/settings'] : ['/documents']);
};
