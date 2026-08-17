import { Component, inject, signal } from '@angular/core';
import { CircleCheck, CircleX, type IconNode, Info } from 'lucide';

import { type ToastKind, Toasts } from '../../services/toasts';
import { Icon } from '../icon/icon';
import { Spinner } from '../spinner/spinner';

// У «loading» значка нет — там крутится спиннер, но запись нужна для полноты.
const ICONS: Record<ToastKind, IconNode> = {
  success: CircleCheck,
  error: CircleX,
  info: Info,
  loading: Info,
};

const CLASSES: Record<ToastKind, string> = {
  success: 'text-emerald-600',
  error: 'text-red-600',
  info: 'text-sky-600',
  loading: 'text-neutral-400',
};

/** Дальше этого сдвига уведомление считается смахнутым. */
const SWIPE_THRESHOLD = 80;
/** Столько длится доводка карточки за край. */
const FLY_OUT_MS = 150;

interface Drag {
  id: number;
  pointerId: number;
  startX: number;
  shift: number;
}

/** Стопка уведомлений в правом нижнем углу. Живёт один раз, в корне приложения. */
@Component({
  selector: 'app-toasts',
  imports: [Icon, Spinner],
  templateUrl: './toast.html',
})
export class ToastStack {
  protected readonly toasts = inject(Toasts);

  /** Сдвиг каждой карточки по горизонтали, пока её тянут. */
  protected readonly shifts = signal<Record<number, number>>({});
  protected readonly draggingId = signal<number | null>(null);

  private drag: Drag | null = null;

  protected icon(kind: ToastKind): IconNode {
    return ICONS[kind];
  }

  protected classes(kind: ToastKind): string {
    return CLASSES[kind];
  }

  protected shift(id: number): number {
    return this.shifts()[id] ?? 0;
  }

  /** Чем дальше утащили, тем прозрачнее карточка. */
  protected opacity(id: number): number {
    return Math.max(0.2, 1 - Math.abs(this.shift(id)) / 240);
  }

  protected onPointerDown(event: PointerEvent, id: number): void {
    if (event.button !== 0) {
      return;
    }

    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.drag = { id, pointerId: event.pointerId, startX: event.clientX, shift: 0 };
    this.draggingId.set(id);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== event.pointerId) {
      return;
    }

    this.drag.shift = event.clientX - this.drag.startX;
    this.setShift(this.drag.id, this.drag.shift);
  }

  protected onPointerUp(event: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== event.pointerId) {
      return;
    }

    const { id, shift } = this.drag;
    this.drag = null;
    this.draggingId.set(null);

    if (Math.abs(shift) < SWIPE_THRESHOLD) {
      this.setShift(id, 0);
      return;
    }

    // Докидываем карточку за край, и только потом убираем из списка.
    this.setShift(id, Math.sign(shift) * 400);
    setTimeout(() => {
      this.toasts.dismiss(id);
      this.clearShift(id);
    }, FLY_OUT_MS);
  }

  private setShift(id: number, value: number): void {
    this.shifts.update((current) => ({ ...current, [id]: value }));
  }

  private clearShift(id: number): void {
    this.shifts.update((current) => {
      const { [id]: _removed, ...rest } = current;
      return rest;
    });
  }
}
