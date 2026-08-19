import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { Auth } from '../../../features/auth/services/auth';
import { TargetPicker } from '../../../features/extensions/components/target-picker/target-picker';
import { Planning } from '../../../features/purchases/services/planning';
import { Header } from './components/header/header';
import { Sidebar, SidebarItem } from './components/sidebar/sidebar';

/** Каркас внутренних страниц: хедер сверху, сайдбар слева, страница в `<router-outlet />`. */
@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, Header, Sidebar, TargetPicker],
  templateUrl: './main-layout.html',
  host: { '(window:resize)': 'onResize()' },
})
export class MainLayout {
  private readonly router = inject(Router);

  private readonly planning = inject(Planning);

  /** Страницы от расширений появляются, только когда те подключены. */
  protected readonly nav = computed<readonly SidebarItem[]>(() => [
    { label: 'Документы', route: '/documents' },
    ...(this.planning.connected() ? [{ label: 'Планирование закупов', route: '/purchases' }] : []),
    { label: 'Расширение', route: '/settings' },
  ]);

  private readonly auth = inject(Auth);

  protected readonly user = computed(() => this.auth.user()?.email ?? '');

  constructor() {
    // Состояние расширений спрашиваем один раз на загрузку: от него зависит,
    // какие страницы вообще есть в меню.
    void this.planning.load().catch(() => undefined);
  }

  // На телефоне сайдбар закрыт: он перекрывает страницу целиком.
  protected readonly sidebarOpen = signal(window.innerWidth >= 1024);

  /**
   * С `lg` выбор магазина стоит в шапке, ниже — переезжает в сайдбар.
   * Прячем не стилями, а условием: иначе в разметке жили бы два выбора,
   * и каждый ходил бы в UMAG за своим списком магазинов.
   */
  protected readonly wide = signal(window.innerWidth >= 1024);

  protected onResize(): void {
    this.wide.set(window.innerWidth >= 1024);
  }

  /** Название открытой страницы — из `title` маршрута. */
  protected readonly pageTitle = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.currentTitle()),
    ),
    { initialValue: this.currentTitle() },
  );

  /** На телефоне шторка перекрывает страницу, поэтому после перехода закрываем. */
  protected closeOnPhone(): void {
    if (window.innerWidth < 1024) {
      this.sidebarOpen.set(false);
    }
  }

  protected logout(): void {
    // Токены стёрты сразу, а гашение refresh на сервере ждать незачем:
    // уводим на вход, не дожидаясь ответа.
    void this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  private currentTitle(): string {
    let route: ActivatedRouteSnapshot = this.router.routerState.snapshot.root;
    let title = route.title ?? '';

    while (route.firstChild) {
      route = route.firstChild;
      title = route.title ?? title;
    }

    return title;
  }
}
