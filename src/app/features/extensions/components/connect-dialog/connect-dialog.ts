import {
  Component,
  Injector,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { Button } from '../../../../shared/components/button/button';
import { Modal } from '../../../../shared/components/modal/modal';
import { TextField } from '../../../../shared/components/text-field/text-field';
import { Toasts } from '../../../../shared/services/toasts';
import {
  type Extension,
  type ExtensionAccount,
  type ExtensionIdentity,
  type ExtensionLabels,
  type ExtensionSetup,
} from '../../models/extension';

/**
 * Подписи по умолчанию. Расширение со входом приносит свои, а окно для
 * расширения без входа не открывается вовсе — но форме нужно что-то писать.
 */
const DEFAULT_LABELS: ExtensionLabels = {
  login: 'Логин',
  loginType: 'text',
  loginPlaceholder: '',
  target: 'Магазин',
  targets: 'Магазины',
  identity: 'Кем заходим?',
  identityHint: '',
};

/**
 * Окно входа в расширение: логин с паролем, а если сервис просит —
 * ещё и выбор, кем заходим. Подписи берутся из описания расширения.
 */
@Component({
  selector: 'app-connect-dialog',
  imports: [ReactiveFormsModule, Modal, TextField, Button],
  templateUrl: './connect-dialog.html',
})
export class ConnectDialog {
  readonly extension = input.required<Extension>();
  /** Сервис и подписи формы: они живут в коде, а не в каталоге. */
  readonly setup = input.required<ExtensionSetup>();
  readonly open = input(false);
  readonly closed = output<void>();
  /** Вход выполнен: в аккаунте уже лежат цели, если их дали выбрать. */
  readonly connected = output<ExtensionAccount>();

  protected readonly form = inject(FormBuilder).nonNullable.group({
    login: ['', Validators.required],
    password: ['', Validators.required],
  });

  protected readonly busy = signal(false);
  /** Сервис просит выбрать, кем заходим. */
  protected readonly identities = signal<ExtensionIdentity[]>([]);

  protected readonly labels = computed(() => this.setup().labels ?? DEFAULT_LABELS);

  private readonly injector = inject(Injector);
  private readonly provider = computed(() => this.injector.get(this.setup().provider));
  private readonly toasts = inject(Toasts);

  constructor() {
    // Окно закрыли — пароль и выбор человека не оставляем на следующий раз.
    effect(() => {
      if (!this.open()) {
        this.form.reset();
        this.identities.set([]);
      }
    });

    // Номер дорисовывается прямо в поле — в тот же вид, что в подсказке.
    this.form.controls.login.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      if (this.labels().loginType !== 'tel') {
        return;
      }

      const formatted = formatPhone(value);

      if (formatted !== value) {
        this.form.controls.login.setValue(formatted, { emitEvent: false });
      }
    });
  }

  protected close(): void {
    if (!this.busy()) {
      this.closed.emit();
    }
  }

  protected async connect(identityId?: number): Promise<void> {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    const { login, password } = this.form.getRawValue();
    const { name } = this.extension();
    const labels = this.labels();

    // Сервису уходит голый номер без скобок и кода страны — так, как он его знает.
    const credential = labels.loginType === 'tel' ? phoneDigits(login) : login.trim();

    try {
      const account = await this.provider().connect(credential, password, identityId);

      // Людей несколько — форму не чистим, она нужна для повторного
      // входа уже выбранным человеком.
      if (account.identities?.length) {
        this.identities.set(account.identities);
        this.toasts.info(labels.identity);
        return;
      }

      this.identities.set([]);
      this.form.reset();
      this.connected.emit(account);
      this.closed.emit();

      this.toasts.success(
        account.connected
          ? `${name} подключён`
          : `Вход выполнен — выберите ${labels.target.toLowerCase()}`,
      );
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : `Не удалось войти в ${name}`);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Код страны в поле стоит отдельно от номера — его цифру в номер не пишем. */
const PHONE_PREFIX = '+7';

/**
 * Голые цифры номера без кода страны: так его знает сервис.
 * Набрали «8 747…», «+7 (747) …» или «747…» — уйдёт одно и то же.
 */
function phoneDigits(value: string): string {
  const trimmed = value.trim();
  const prefixed = trimmed.startsWith(PHONE_PREFIX);
  const digits = (prefixed ? trimmed.slice(PHONE_PREFIX.length) : trimmed).replace(/\D/g, '');

  // Номер начали с восьмёрки — она тоже код страны, а не первая цифра.
  const national = !prefixed && digits.startsWith('8') ? digits.slice(1) : digits;

  return national.length > 10 ? national.slice(-10) : national;
}

/**
 * Тот же вид, что в подсказке: +7 (700) 000-00-00.
 * Хвостовые скобки и дефисы не дорисовываем, иначе их не стереть.
 */
function formatPhone(value: string): string {
  const digits = phoneDigits(value);

  if (!digits) {
    return '';
  }

  const [operator, prefix, pair, tail] = [
    digits.slice(0, 3),
    digits.slice(3, 6),
    digits.slice(6, 8),
    digits.slice(8, 10),
  ];

  let formatted = `${PHONE_PREFIX} (${operator}`;

  if (prefix) {
    formatted += `) ${prefix}`;
  }

  if (pair) {
    formatted += `-${pair}`;
  }

  if (tail) {
    formatted += `-${tail}`;
  }

  return formatted;
}
