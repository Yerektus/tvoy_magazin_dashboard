import {
  Component,
  DestroyRef,
  Injector,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Check, Info } from 'lucide';

import { Button } from '../../../../shared/components/button/button';
import { Icon } from '../../../../shared/components/icon/icon';
import { Spinner } from '../../../../shared/components/spinner/spinner';
import { Confirm } from '../../../../shared/services/confirm';
import { PageHeader } from '../../../../shared/services/page-header';
import { Toasts } from '../../../../shared/services/toasts';
import { ConnectDialog } from '../../components/connect-dialog/connect-dialog';
import { type Extension, type ExtensionAccount, type ExtensionLink } from '../../models/extension';
import { setupFor } from '../../providers';
import { Catalog } from '../../services/catalog';

/** Страница расширения: описание с возможностями и всё про подключение. */
@Component({
  selector: 'app-extension-details',
  imports: [Button, Icon, RouterLink, Spinner, ConnectDialog],
  templateUrl: './extension-details.html',
})
export class ExtensionDetails {
  /** Приходит из `:slug` в маршруте. */
  readonly slug = input.required<string>();

  protected readonly checkIcon = Check;
  protected readonly infoIcon = Info;

  protected readonly extension = signal<Extension | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly connectOpen = signal(false);

  private readonly injector = inject(Injector);
  private readonly catalog = inject(Catalog);
  private readonly router = inject(Router);
  private readonly header = inject(PageHeader);
  private readonly toasts = inject(Toasts);
  private readonly confirm = inject(Confirm);

  /** Пусто — расширение есть в каталоге, а кода для него ещё нет. */
  protected readonly setup = computed(() => setupFor(this.slug()));
  protected readonly labels = computed(() => this.setup()?.labels ?? null);

  private readonly provider = computed(() => {
    const setup = this.setup();
    return setup ? this.injector.get(setup.provider) : null;
  });

  protected readonly account = computed<ExtensionAccount | null>(
    () => this.provider()?.account() ?? null,
  );

  /**
   * Подключено: показываем состояние, а не приглашение подключиться.
   * У расширений со входом признак — логин, у остальных сам флаг.
   */
  protected readonly linked = computed(
    () => Boolean(this.account()?.login) || this.account()?.connected === true,
  );

  /**
   * Короткая подпись рядом с названием. Подробности вроде выбранного магазина
   * живут в шапке, здесь важно одно: подключено или нет.
   */
  protected readonly state = computed(() => (this.linked() ? 'Подключено' : 'Не подключено'));

  constructor() {
    effect(() => {
      void this.load(this.slug());
    });

    inject(DestroyRef).onDestroy(() => this.header.clear());
  }

  /** Подключено ли расширение, без которого это не работает. */
  protected ready(required: ExtensionLink): boolean {
    const setup = setupFor(required.slug);

    if (!setup) {
      return false;
    }

    const account = this.injector.get(setup.provider).account();

    return Boolean(account?.login) || account?.connected === true;
  }

  /**
   * Расширению со своим входом нужно окно с логином и паролем, надстройка
   * над уже подключённым сервисом включается прямо отсюда.
   */
  protected async connect(): Promise<void> {
    const extension = this.extension();

    if (this.labels()) {
      this.connectOpen.set(true);
      return;
    }

    this.busy.set(true);

    try {
      await this.provider()?.connect('', '');
      this.toasts.success(`${extension?.name ?? 'Расширение'} подключено`);
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось подключить');
    } finally {
      this.busy.set(false);
    }
  }

  protected async disconnect(): Promise<void> {
    const extension = this.extension();
    if (!extension) {
      return;
    }

    const agreed = await this.confirm.ask({
      title: `Отключить ${extension.name}?`,
      message: `Накладные перестанут уходить в ${extension.name}, пока не войдёте заново.`,
      confirmLabel: 'Отключить',
      danger: true,
    });

    if (!agreed) {
      return;
    }

    try {
      await this.provider()?.disconnect();
      this.toasts.success(`${extension.name} отключён`);

      // Надстройки без него не работают, и бэкенд снял их следом —
      // перечитываем состояние, чтобы страницы ушли из меню сразу.
      await Promise.all(extension.required_by.map((item) => this.reload(item)));
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось отключить');
    }
  }

  private async load(slug: string): Promise<void> {
    this.loading.set(true);

    try {
      const extension = await this.catalog.get(slug);
      this.extension.set(extension);
      this.header.setCrumbs([
        { label: 'Расширение', route: '/settings' },
        { label: extension.name },
      ]);

      // Состояние обязательных расширений — чтобы показать, чего не хватает.
      await Promise.all(extension.requires.map((required) => this.warm(required)));
    } catch {
      // Адреса с чужим кодом расширения не существует — возвращаем в каталог.
      void this.router.navigateByUrl('/settings');
      return;
    }

    const provider = this.provider();
    if (!provider) {
      this.loading.set(false);
      return;
    }

    try {
      // Магазин выбирают в шапке, здесь хватает состояния подключения.
      await provider.load();
    } catch {
      // Молча: страница откроется в состоянии «не подключено».
    } finally {
      this.loading.set(false);
    }
  }

  /** Спрашивает состояние соседнего расширения, если по нему ещё не ходили. */
  private async warm(required: ExtensionLink): Promise<void> {
    const setup = setupFor(required.slug);
    const provider = setup ? this.injector.get(setup.provider) : null;

    if (provider?.account() === null) {
      await this.reload(required);
    }
  }

  /** Перечитывает состояние соседнего расширения. */
  private async reload(link: ExtensionLink): Promise<void> {
    const setup = setupFor(link.slug);

    if (setup) {
      await this.injector
        .get(setup.provider)
        .load()
        .catch(() => undefined);
    }
  }
}
