import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { X } from 'lucide';

import { Button } from '../button/button';
import { Icon } from '../icon/icon';

/** Столько же длятся анимации `modal-out` и `fade-out` в `styles.css`. */
const LEAVE_MS = 150;

/**
 * Модальное окно. Содержимое проецируется внутрь, кнопки — в слот `modalActions`:
 *
 * ```html
 * <app-modal [open]="open()" title="Заголовок" (closed)="open.set(false)">
 *   …
 *   <div modalActions><app-button>ОК</app-button></div>
 * </app-modal>
 * ```
 */
@Component({
  selector: 'app-modal',
  imports: [Button, Icon],
  templateUrl: './modal.html',
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class Modal {
  readonly open = input(false);
  readonly title = input('');
  /** `lg` — для широкого содержимого вроде фотографии. */
  readonly size = input<'md' | 'lg'>('md');
  readonly closed = output<void>();

  protected readonly widthClass = computed(() => (this.size() === 'lg' ? 'max-w-3xl' : 'max-w-md'));

  protected readonly closeIcon = X;

  /** Окно в DOM: при закрытии держится, пока играет анимация. */
  protected readonly rendered = signal(false);
  protected readonly leaving = signal(false);

  private readonly document = inject(DOCUMENT);
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      if (this.open()) {
        this.clearLeaveTimer();
        this.leaving.set(false);
        this.rendered.set(true);
        return;
      }

      if (!this.rendered() || this.leaving()) {
        return;
      }

      this.leaving.set(true);
      this.leaveTimer = setTimeout(() => {
        this.rendered.set(false);
        this.leaving.set(false);
        this.leaveTimer = null;
      }, LEAVE_MS);
    });

    // Пока окно открыто, страница под ним не скроллится.
    effect((onCleanup) => {
      if (!this.rendered()) {
        return;
      }

      const { body } = this.document;
      const previous = body.style.overflow;
      body.style.overflow = 'hidden';
      onCleanup(() => {
        body.style.overflow = previous;
      });
    });

    inject(DestroyRef).onDestroy(() => this.clearLeaveTimer());
  }

  protected onEscape(): void {
    if (this.open()) {
      this.closed.emit();
    }
  }

  private clearLeaveTimer(): void {
    if (this.leaveTimer !== null) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  }
}
