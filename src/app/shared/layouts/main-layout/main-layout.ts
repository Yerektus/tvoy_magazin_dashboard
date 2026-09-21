import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { ChartLine, FileText, Package, Puzzle, ShoppingCart } from 'lucide';
import { filter, map } from 'rxjs';

import { Auth } from '../../../features/auth/services/auth';
import { Recognition } from '../../../features/documents/services/recognition';
import { TargetPicker } from '../../../features/extensions/components/target-picker/target-picker';
import { Planning } from '../../../features/purchases/services/planning';
import { Assistant } from '../../../features/assistant/services/assistant';
import { ChatSidebar } from '../../../features/assistant/components/chat-sidebar/chat-sidebar';
import { Header } from './components/header/header';
import { Sidebar, SidebarItem } from './components/sidebar/sidebar';

/** Каркас внутренних страниц: хедер сверху, сайдбар слева, страница в `<router-outlet />`. */
@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, Header, Sidebar, TargetPicker, ChatSidebar],
  templateUrl: './main-layout.html',
})
export class MainLayout {
  private readonly router = inject(Router);

  private readonly planning = inject(Planning);
  private readonly recognition = inject(Recognition);
  private readonly auth = inject(Auth);
  protected readonly assistant = inject(Assistant);

  /**
   * Страницы от расширений появляются, только когда те подключены, а сам
   * каталог расширений — только у владельца и администратора: менеджер с
   * накладными работает, но организацией не заведует.
   */
  protected readonly nav = computed<readonly SidebarItem[]>(() => [
    ...(this.recognition.connected()
      ? [{ label: 'Документы', icon: FileText, route: '/documents' }]
      : []),
    ...(this.planning.connected()
      ? [
          { label: 'Товары', icon: Package, route: '/products' },
          { label: 'Аналитика продаж', icon: ChartLine, route: '/sales' },
          { label: 'Планирование закупов', icon: ShoppingCart, route: '/purchases' },
        ]
      : []),
    ...(this.auth.managesOrganization()
      ? [{ label: 'Расширение', icon: Puzzle, route: '/settings' }]
      : []),
  ]);

  /** Пока спрашиваем расширения, пункты меню ещё не окончательны. */
  protected readonly navLoading = computed(
    () => this.planning.loading() || this.recognition.loading(),
  );

  protected readonly user = computed(() => this.auth.user()?.email ?? '');

  constructor() {
    // Состояние расширений спрашиваем один раз на загрузку: от него зависит,
    // какие страницы вообще есть в меню.
    void this.planning.load().catch(() => undefined);
    void this.recognition.load().catch(() => undefined);
    // И кто мы — тоже: роль в сохранённом профиле могла устареть, а от неё
    // зависит, показывать ли расширения.
    void this.auth.reload();
  }

  // На телефоне сайдбар закрыт: он перекрывает страницу целиком.
  protected readonly sidebarOpen = signal(window.innerWidth >= 1024);

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
    this.assistant.reset();
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
