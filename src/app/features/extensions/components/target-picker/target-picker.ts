import { Component, Injector, computed, effect, inject, input, signal } from '@angular/core';

import {
  Select,
  type SelectOption,
  type SelectValue,
} from '../../../../shared/components/select/select';
import { Toasts } from '../../../../shared/services/toasts';
import { type ExtensionProvider, type ExtensionTarget } from '../../models/extension';
import { setupFor } from '../../providers';

/**
 * Выбор цели подключённого расширения прямо в шапке: у UMAG это магазин,
 * в который уходят приёмки. Пока расширение не подключено, в шапке пусто.
 */
@Component({
  selector: 'app-target-picker',
  imports: [Select],
  templateUrl: './target-picker.html',
  // Не подключено — компонент ничего не рисует и не занимает места в строке.
  host: { class: 'contents' },
})
export class TargetPicker {
  /** Код расширения из каталога: `umag`. */
  readonly slug = input.required<string>();

  /** Ширина выбора: в шапке она фиксированная, в сайдбаре — во всю колонку. */
  readonly width = input('w-44 sm:w-56');

  protected readonly busy = signal(false);
  protected readonly targets = signal<readonly ExtensionTarget[]>([]);

  private readonly injector = inject(Injector);
  private readonly toasts = inject(Toasts);

  private readonly setup = computed(() => setupFor(this.slug()));
  protected readonly labels = computed(() => this.setup()?.labels ?? null);

  private readonly provider = computed<ExtensionProvider | null>(() => {
    const setup = this.setup();
    return setup ? this.injector.get(setup.provider) : null;
  });

  protected readonly account = computed(() => this.provider()?.account() ?? null);

  /** Вход есть — в шапке появляется выбор. */
  protected readonly linked = computed(() => Boolean(this.account()?.login));

  /** Пока список не приехал, в выборе стоит одна текущая цель. */
  protected readonly items = computed<SelectOption[]>(() => {
    const targets = this.targets();
    const account = this.account();

    const list: readonly ExtensionTarget[] = targets.length
      ? targets
      : account?.targetId
        ? [{ id: account.targetId, name: account.targetName }]
        : [];

    return list.map((target) => ({ value: target.id, label: target.name }));
  });

  /** Список целей спрашиваем один раз, пока расширение остаётся подключённым. */
  private fetched = false;

  constructor() {
    effect(() => {
      const provider = this.provider();
      if (!provider) {
        return;
      }

      const account = provider.account();

      // По расширению ещё не ходили — заодно узнаем, подключено ли оно.
      if (account === null) {
        void provider.load().catch(() => undefined);
        return;
      }

      if (!account.login) {
        this.fetched = false;
        this.targets.set([]);
        return;
      }

      if (!this.fetched) {
        this.fetched = true;
        void this.load(provider);
      }
    });
  }

  protected async choose(value: SelectValue): Promise<void> {
    const provider = this.provider();
    const chosen = Number(value);

    if (!provider || !chosen) {
      return;
    }

    this.busy.set(true);

    try {
      await provider.chooseTarget?.(chosen);

      const name = this.items().find((item) => item.value === chosen)?.label ?? '';
      this.toasts.success(`${this.labels()?.target}: «${name}»`);
    } catch (error) {
      // Не переключилось — в выборе останется прежняя цель: она из состояния.
      this.toasts.error(
        error instanceof Error ? error.message : 'Не удалось переключиться на другую цель',
      );
    } finally {
      this.busy.set(false);
    }
  }

  private async load(provider: ExtensionProvider): Promise<void> {
    try {
      const found = (await provider.targets?.()) ?? [];
      this.targets.set(found);

      // Цель не выбрана — берём первую сами. Без неё расширение всё равно не
      // работает: ни план не посчитать, ни приёмку отправить, — а выбор из
      // одинаковых на вид магазинов человек всё равно делает наугад.
      if (!provider.account()?.targetId && found.length) {
        await this.choose(found[0].id);
      }
    } catch {
      // Молча: в выборе останется текущая цель.
    }
  }
}
