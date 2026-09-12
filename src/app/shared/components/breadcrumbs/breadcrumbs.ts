import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Skeleton } from '../skeleton/skeleton';

export interface Breadcrumb {
  label: string;
  /** Без адреса пункт рисуется просто текстом. */
  route?: string;
  /** Вместо подписи — скелетон, пока страница деталей ещё грузится. */
  loading?: boolean;
}

/** Хлебные крошки: `<app-breadcrumbs [items]="[{ label: 'Документы', route: '/documents' }, …]" />`. */
@Component({
  selector: 'app-breadcrumbs',
  imports: [RouterLink, Skeleton],
  templateUrl: './breadcrumbs.html',
  host: { class: 'block min-w-0' },
})
export class Breadcrumbs {
  readonly items = input.required<readonly Breadcrumb[]>();
}
