import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

export const APP_NAME = 'Твой магазин';

/**
 * Маршруты хранят короткое название страницы («Обзор»), его же показывает хедер.
 * В заголовок вкладки дописывается название проекта: «Обзор — Твой магазин».
 */
@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const page = this.buildTitle(snapshot);
    this.title.setTitle(page ? `${page} — ${APP_NAME}` : APP_NAME);
  }
}
