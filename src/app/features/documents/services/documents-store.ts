import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../../../shared/services/api-config';
import { Toasts } from '../../../shared/services/toasts';
import { type DocumentItem, type DocumentLine, isPending } from '../models/document';

interface Page<T> {
  count: number;
  results: T[];
}

export interface FailedUpload {
  name: string;
  message: string;
}

export interface UploadResult {
  created: DocumentItem[];
  failed: FailedUpload[];
}

/** Как часто спрашиваем бэкенд, закончил ли ИИ разбирать накладную. */
const POLL_INTERVAL = 2500;
/**
 * Дольше этого не ждём. Запас большой: накладные разбираются по очереди,
 * и пачка из десятка файлов честно занимает много минут.
 */
const POLL_TIMEOUT = 20 * 60 * 1000;

/**
 * Столько неудачных опросов подряд считаем поломкой, а не морганием сети:
 * иначе накладная молча висит «в очереди», хотя статус давно не отвечает.
 */
const POLL_FAILURES = 5;

@Injectable({ providedIn: 'root' })
export class DocumentsStore {
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(Toasts);
  private readonly url = `${API_BASE_URL}/invoices/`;

  private readonly items = signal<DocumentItem[]>([]);

  readonly documents = this.items.asReadonly();
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Открытая вкладка списка: `all`, `pending`, `checked` или `deleted`. */
  private readonly tab = signal('all');

  /** Сколько накладных в каждой вкладке: числа стоят рядом с их названиями. */
  readonly counts = signal<Record<string, number>>({});

  /** id накладных, за которыми уже следит поллинг. */
  private readonly watched = new Set<number>();

  /**
   * Список выбранной вкладки. Вкладку запоминаем: после загрузки фото или
   * удаления список обновляется сам и должен остаться там же, где был.
   */
  async load(tab?: string): Promise<void> {
    if (tab) {
      this.tab.set(tab);
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const params = this.tab() === 'all' ? {} : { params: { tab: this.tab() } };
      const page = await firstValueFrom(this.http.get<Page<DocumentItem>>(this.url, params));
      this.items.set(page.results);
      this.total.set(page.count);
      page.results.filter(isPending).forEach((document) => this.watch(document.id));

      void this.refreshCounts();
    } catch (error) {
      const message = describe(error);
      this.error.set(message);
      this.toasts.error(message);
    } finally {
      this.loading.set(false);
    }
  }

  /** Пересчитывает вкладки. Молча: числа рядом с ними — не повод для ошибки. */
  async refreshCounts(): Promise<void> {
    try {
      this.counts.set(
        await firstValueFrom(this.http.get<Record<string, number>>(`${this.url}counts/`)),
      );
    } catch {
      // Оставляем прежние числа.
    }
  }

  async fetch(id: number): Promise<DocumentItem> {
    const document = await firstValueFrom(this.http.get<DocumentItem>(`${this.url}${id}/`));
    this.merge(document);
    return document;
  }

  /** Загружает одно фото. Обновление списка — на вызывающем. */
  async upload(photo: File): Promise<DocumentItem> {
    const form = new FormData();
    form.append('image', photo);

    try {
      return await firstValueFrom(this.http.post<DocumentItem>(this.url, form));
    } catch (error) {
      throw new Error(describe(error));
    }
  }

  /**
   * Загружает пачку фотографий по очереди: сервер не получает десяток тяжёлых
   * файлов разом, а неудачный файл не роняет остальные.
   */
  async uploadMany(
    photos: readonly File[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<UploadResult> {
    const created: DocumentItem[] = [];
    const failed: FailedUpload[] = [];

    for (const [index, photo] of photos.entries()) {
      try {
        created.push(await this.upload(photo));
      } catch (error) {
        failed.push({
          name: photo.name,
          message: error instanceof Error ? error.message : 'Не удалось загрузить',
        });
      }

      onProgress?.(index + 1, photos.length);
    }

    if (created.length) {
      await this.load();
      created.forEach((document) => this.watch(document.id));
    }

    return { created, failed };
  }

  /** Человек сверил распознанное с бумагой. */
  async check(id: number): Promise<DocumentItem> {
    const checked = await firstValueFrom(
      this.http.post<DocumentItem>(`${this.url}${id}/check/`, {}),
    );
    this.merge(checked);
    void this.refreshCounts();

    return checked;
  }

  /**
   * Правка поставщика. Название и БИН стоят на печати, а не в таблице, и
   * читаются с фото хуже всего — их чаще прочего приходится вписывать руками.
   */
  async updateDocument(id: number, patch: Partial<DocumentItem>): Promise<DocumentItem> {
    try {
      const saved = await firstValueFrom(
        this.http.patch<DocumentItem>(`${this.url}${id}/`, patch),
      );
      // Список открыт за карточкой — там та же накладная, и она должна сойтись.
      this.merge(saved);

      return saved;
    } catch (error) {
      throw new Error(describe(error));
    }
  }

  /** Правка распознанной позиции: модель ошибается, бумага — источник истины. */
  async updateLine(
    invoiceId: number,
    lineId: number,
    patch: Partial<DocumentLine>,
  ): Promise<DocumentLine> {
    try {
      return await firstValueFrom(
        this.http.patch<DocumentLine>(`${this.url}${invoiceId}/lines/${lineId}/`, patch),
      );
    } catch (error) {
      throw new Error(describe(error));
    }
  }

  /** Пропущенная строка: на бумаге позиция есть, а модель её не увидела. */
  async addLine(invoiceId: number): Promise<DocumentLine> {
    try {
      return await firstValueFrom(
        this.http.post<DocumentLine>(`${this.url}${invoiceId}/lines/`, {}),
      );
    } catch (error) {
      throw new Error(describe(error));
    }
  }

  /** Лишняя строка: модель придумала позицию, которой на бумаге нет. */
  async removeLine(invoiceId: number, lineId: number): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(`${this.url}${invoiceId}/lines/${lineId}/`));
    } catch (error) {
      throw new Error(describe(error));
    }
  }

  async retry(id: number): Promise<void> {
    await firstValueFrom(this.http.post<DocumentItem>(`${this.url}${id}/retry/`, {}));
    await this.fetch(id);
    this.watch(id);
  }

  async remove(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.url}${id}/`));
    this.items.update((current) => current.filter((document) => document.id !== id));
    this.total.update((count) => Math.max(0, count - 1));
    this.watched.delete(id);
    void this.refreshCounts();
  }

  /**
   * Опрашивает накладную, пока ИИ её разбирает. Бэкенд отвечает на загрузку
   * сразу, а распознавание идёт в фоне — статус приходится спрашивать самим.
   */
  watch(id: number): void {
    if (this.watched.has(id)) {
      return;
    }

    this.watched.add(id);
    const startedAt = Date.now();
    let failures = 0;

    const tick = async () => {
      if (!this.watched.has(id)) {
        return;
      }

      try {
        const document = await this.fetch(id);
        failures = 0;

        if (!isPending(document)) {
          this.watched.delete(id);
          this.announce(document);
          return;
        }
      } catch {
        failures += 1;

        // Сеть моргнула — попробуем на следующем круге. А вот когда статус не
        // отвечает раз за разом, честнее сказать, чем показывать «в очереди».
        if (failures >= POLL_FAILURES) {
          this.watched.delete(id);
          this.toasts.error('Статус накладной не отвечает — обновите страницу');
          return;
        }
      }

      if (Date.now() - startedAt > POLL_TIMEOUT) {
        this.watched.delete(id);
        return;
      }

      setTimeout(tick, POLL_INTERVAL);
    };

    setTimeout(tick, POLL_INTERVAL);
  }

  /** Сообщает, чем закончился разбор — поллинг тихо завершаться не должен. */
  private announce(document: DocumentItem): void {
    if (document.status === 'done') {
      this.toasts.success(`Накладная распознана: позиций ${document.lines_count}`);
      return;
    }

    this.toasts.error(document.error || 'Не удалось распознать накладную');
  }

  /** Кладёт свежую версию накладной в список, сохраняя порядок. */
  private merge(document: DocumentItem): void {
    this.items.update((current) => {
      const index = current.findIndex((item) => item.id === document.id);

      if (index === -1) {
        return current;
      }

      const next = [...current];
      next[index] = { ...next[index], ...document };
      return next;
    });
  }
}

function describe(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Не удалось связаться с сервером';
  }

  if (error.status === 0) {
    return 'Сервер недоступен. Проверьте, запущен ли API.';
  }

  const body = error.error;

  if (body && typeof body === 'object') {
    const payload = body as Record<string, unknown>;

    for (const key of ['image', 'detail', 'non_field_errors']) {
      const value = payload[key];

      if (typeof value === 'string' && value.trim()) {
        return value;
      }

      if (Array.isArray(value) && typeof value[0] === 'string') {
        return value[0];
      }
    }
  }

  return `Ошибка сервера (${error.status})`;
}
