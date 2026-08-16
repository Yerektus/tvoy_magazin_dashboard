import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  Injector,
} from '@angular/core';

/**
 * Значение, которое правится по клику прямо в таблице:
 *
 * ```html
 * <app-editable-text [value]="line.price" [display]="formatMoney(line.price)"
 *                    align="right" (changed)="save($event)" />
 * ```
 *
 * Enter сохраняет, Esc отменяет, потеря фокуса тоже сохраняет.
 */
@Component({
  selector: 'app-editable-text',
  templateUrl: './editable-text.html',
  host: { class: 'block' },
})
export class EditableText {
  readonly value = input<string | null>('');
  /** Что показывать, пока не правят: цена с валютой, количество без нулей. */
  readonly display = input<string | null>(null);
  readonly align = input<'left' | 'right'>('left');
  readonly placeholder = input('—');
  readonly disabled = input(false);

  readonly changed = output<string>();

  protected readonly editing = signal(false);
  protected readonly draft = signal('');

  protected readonly text = computed(() => this.display() ?? this.value() ?? '');
  protected readonly alignClass = computed(() =>
    this.align() === 'right' ? 'text-right' : 'text-left',
  );

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly injector = inject(Injector);

  protected start(): void {
    if (this.disabled() || this.editing()) {
      return;
    }

    this.draft.set(this.value() ?? '');
    this.editing.set(true);

    // Поле появляется только сейчас — фокус ставим после отрисовки.
    afterNextRender(
      () => {
        const field = this.field()?.nativeElement;
        field?.focus();
        field?.select();
      },
      { injector: this.injector },
    );
  }

  protected save(): void {
    if (!this.editing()) {
      return;
    }

    const next = this.draft().trim();
    this.editing.set(false);

    if (next !== (this.value() ?? '')) {
      this.changed.emit(next);
    }
  }

  protected cancel(): void {
    this.editing.set(false);
  }

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }
}
