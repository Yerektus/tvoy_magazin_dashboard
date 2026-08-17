import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info' | 'loading';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

/** Сколько уведомление висит, прежде чем уехать само. */
const LIFETIME = 4000;

/** Всплывающие уведомления об итоге запросов. */
@Injectable({ providedIn: 'root' })
export class Toasts {
  private readonly items = signal<Toast[]>([]);
  private nextId = 0;

  readonly toasts = this.items.asReadonly();

  success(text: string): void {
    this.show(text, 'success');
  }

  error(text: string): void {
    this.show(text, 'error');
  }

  info(text: string): void {
    this.show(text, 'info');
  }

  show(text: string, kind: ToastKind = 'info'): void {
    const id = this.nextId++;
    this.items.update((current) => [...current, { id, kind, text }]);
    setTimeout(() => this.dismiss(id), LIFETIME);
  }

  /**
   * Уведомление о том, что запрос ещё идёт: с крутящимся значком и без срока.
   * Убирает его `settle`, когда запрос закончится. Возвращает номер — им же
   * потом и закрывают.
   */
  loading(text: string): number {
    const id = this.nextId++;
    this.items.update((current) => [...current, { id, kind: 'loading', text }]);

    return id;
  }

  /**
   * Запрос закончился: та же карточка на месте меняет значок и текст, а дальше
   * уезжает сама. Так итог появляется там, где человек уже смотрит, и стопка
   * не прыгает.
   */
  settle(id: number, text: string, kind: ToastKind = 'success'): void {
    // Карточку могли смахнуть, не дождавшись ответа — тогда и показывать нечего.
    if (!this.items().some((toast) => toast.id === id)) {
      return;
    }

    this.items.update((current) =>
      current.map((toast) => (toast.id === id ? { ...toast, kind, text } : toast)),
    );

    setTimeout(() => this.dismiss(id), LIFETIME);
  }

  dismiss(id: number): void {
    this.items.update((current) => current.filter((toast) => toast.id !== id));
  }
}
