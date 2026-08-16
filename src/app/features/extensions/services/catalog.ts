import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../../../shared/services/api-config';
import { type Extension } from '../models/extension';

/** Каталог расширений: заводятся в админке, сюда приходят готовым списком. */
@Injectable({ providedIn: 'root' })
export class Catalog {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE_URL}/extensions/`;

  private readonly state = signal<readonly Extension[]>([]);

  readonly items = this.state.asReadonly();

  async load(): Promise<readonly Extension[]> {
    const items = await firstValueFrom(this.http.get<Extension[]>(this.url));
    this.state.set(items);
    return items;
  }

  /** Одно расширение: страница открывается и по прямой ссылке. */
  async get(slug: string): Promise<Extension> {
    const known = this.state().find((extension) => extension.slug === slug);

    return known ?? (await firstValueFrom(this.http.get<Extension>(`${this.url}${slug}/`)));
  }
}
