import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';

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

  dismiss(id: number): void {
    this.items.update((current) => current.filter((toast) => toast.id !== id));
  }
}
