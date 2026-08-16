import { Injectable, signal } from '@angular/core';

import type { Breadcrumb } from '../components/breadcrumbs/breadcrumbs';

/**
 * Что страница показывает в шапке: хлебные крошки и табы.
 * Страница заполняет это при создании и чистит при уходе:
 *
 * ```ts
 * constructor() {
 *   this.header.setTabs(['Информация', 'История']);
 *   inject(DestroyRef).onDestroy(() => this.header.clear());
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class PageHeader {
  private readonly crumbList = signal<readonly Breadcrumb[]>([]);
  private readonly tabLabels = signal<readonly string[]>([]);
  private readonly activeLabel = signal<string | null>(null);
  private readonly tabBadges = signal<Record<string, number>>({});

  /** Пусто — шапка показывает название страницы из маршрута. */
  readonly crumbs = this.crumbList.asReadonly();
  readonly tabs = this.tabLabels.asReadonly();
  readonly activeTab = this.activeLabel.asReadonly();
  /** Числа рядом с вкладками: сколько накладных ждёт проверки. */
  readonly badges = this.tabBadges.asReadonly();

  setCrumbs(crumbs: readonly Breadcrumb[]): void {
    this.crumbList.set(crumbs);
  }

  setTabs(labels: readonly string[]): void {
    this.tabLabels.set(labels);
    this.activeLabel.set(labels[0] ?? null);
  }

  selectTab(label: string): void {
    this.activeLabel.set(label);
  }

  /** Счётчики по названию вкладки. Ноль и пусто не показываются. */
  setBadges(badges: Record<string, number>): void {
    this.tabBadges.set(badges);
  }

  clear(): void {
    this.crumbList.set([]);
    this.tabLabels.set([]);
    this.activeLabel.set(null);
    this.tabBadges.set({});
  }
}
