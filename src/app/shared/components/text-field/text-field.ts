import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, NgControl, ValidationErrors } from '@angular/forms';

export type TextFieldType = 'text' | 'email' | 'password' | 'tel' | 'url' | 'number' | 'search';

const DEFAULT_MESSAGES: Record<string, string> = {
  required: 'Заполните поле',
  email: 'Похоже, в адресе опечатка',
  minlength: 'Слишком короткое значение',
  maxlength: 'Слишком длинное значение',
  min: 'Значение слишком маленькое',
  max: 'Значение слишком большое',
  pattern: 'Неверный формат',
};

let nextId = 0;

/**
 * Текстовое поле с меткой и текстом ошибки.
 * Работает с реактивными формами: `<app-text-field formControlName="email" label="Почта" />`.
 */
@Component({
  selector: 'app-text-field',
  templateUrl: './text-field.html',
})
export class TextField implements ControlValueAccessor, OnInit {
  readonly label = input.required<string>();
  readonly type = input<TextFieldType>('text');
  readonly placeholder = input('');
  readonly autocomplete = input('');
  readonly inputMode = input('');
  readonly hint = input('');
  readonly readonly = input(false);
  /** Свои тексты ошибок по ключу валидатора: `{ required: 'Введите почту' }`. */
  readonly errorMessages = input<Record<string, string>>({});

  protected readonly controlId = `text-field-${nextId++}`;
  protected readonly value = signal('');
  protected readonly disabled = signal(false);

  private readonly state = signal<{ touched: boolean; errors: ValidationErrors | null }>({
    touched: false,
    errors: null,
  });

  protected readonly errorText = computed(() => {
    const { touched, errors } = this.state();
    if (!touched || !errors) {
      return null;
    }

    const messages = { ...DEFAULT_MESSAGES, ...this.errorMessages() };
    const [firstError] = Object.keys(errors);
    return messages[firstError] ?? 'Проверьте значение';
  });

  protected readonly describedBy = computed(() => {
    if (this.errorText()) {
      return `${this.controlId}-error`;
    }
    return this.hint() ? `${this.controlId}-hint` : null;
  });

  private readonly ngControl = inject(NgControl, { self: true, optional: true });
  private readonly destroyRef = inject(DestroyRef);

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    if (this.ngControl) {
      this.ngControl.valueAccessor = this;
    }
  }

  ngOnInit(): void {
    const control = this.ngControl?.control;
    if (!control) {
      return;
    }

    const sync = () => this.state.set({ touched: control.touched, errors: control.errors });
    sync();
    control.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(sync);
  }

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected handleInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.value.set(value);
    this.onChange(value);
  }

  protected handleBlur(): void {
    this.onTouched();
  }
}
