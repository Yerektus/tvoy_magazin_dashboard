import { Component, Injector, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Plus } from 'lucide';

import { Button } from '../../../../shared/components/button/button';
import { Icon } from '../../../../shared/components/icon/icon';
import { Toasts } from '../../../../shared/services/toasts';
import { ConnectDialog } from '../../components/connect-dialog/connect-dialog';
import { type Extension, type ExtensionAccount, type ExtensionSetup } from '../../models/extension';
import { setupFor } from '../../providers';
import { Catalog } from '../../services/catalog';

/** Каталог расширений: карточка на каждое, подключить можно прямо из неё. */
@Component({
  selector: 'app-extensions',
  imports: [Button, Icon, ConnectDialog],
  templateUrl: './extensions.html',
})
export class Extensions {
  protected readonly addIcon = Plus;

  protected readonly loading = signal(true);
  /** Какое расширение сейчас подключается: у его кнопки крутится спиннер. */
  protected readonly busy = signal('');

  /** Расширение со входом: для него открыто окно с логином и паролем. */
  protected readonly connecting = signal<Extension | null>(null);
  protected readonly connectOpen = signal(false);

  private readonly catalog = inject(Catalog);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);

  protected readonly items = this.catalog.items;

  constructor() {
    void this.load();
  }

  /** Подключено — кнопка «Подключить» с карточки уходит. */
  protected connected(extension: Extension): boolean {
    const account = this.account(extension);

    // У расширений со входом признак — логин, у остальных сам флаг.
    return Boolean(account?.login) || account?.connected === true;
  }

  /** Подключать нечем: расширение завели в базе, а кода для него ещё нет. */
  protected available(extension: Extension): boolean {
    return setupFor(extension.slug) !== null;
  }

  /**
   * Подпись под названием. Подробности вроде выбранного магазина живут в
   * шапке, карточке достаточно сказать, подключено расширение или нет.
   */
  protected status(extension: Extension): string {
    if (!this.available(extension)) {
      return 'Скоро';
    }

    return this.connected(extension) ? 'Подключено' : 'Не подключено';
  }

  protected open(extension: Extension): void {
    void this.router.navigate(['/settings', extension.slug]);
  }

  /** Подключает прямо из каталога: со входом — окном, без входа — кнопкой. */
  protected async connect(extension: Extension): Promise<void> {
    const setup = setupFor(extension.slug);

    if (!setup || this.busy()) {
      return;
    }

    if (setup.labels) {
      this.connecting.set(extension);
      this.connectOpen.set(true);
      return;
    }

    this.busy.set(extension.slug);

    try {
      await this.injector.get(setup.provider).connect('', '');
      this.toasts.success(`${extension.name} подключено`);
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось подключить');
    } finally {
      this.busy.set('');
    }
  }

  /** Окну нужны и сервис, и подписи — они лежат рядом с расширением. */
  protected setup(extension: Extension): ExtensionSetup | null {
    return setupFor(extension.slug);
  }

  /** Клик по карточке, кроме кликов по её кнопкам: они ведут туда же сами. */
  protected openCard(event: Event, extension: Extension): void {
    const target = event.target as HTMLElement | null;

    if (!target?.closest('a, button')) {
      this.open(extension);
    }
  }

  private account(extension: Extension): ExtensionAccount | null {
    const setup = setupFor(extension.slug);

    return setup ? this.injector.get(setup.provider).account() : null;
  }

  private async load(): Promise<void> {
    try {
      const items = await this.catalog.load();

      await Promise.all(
        items.map(async (extension) => {
          const setup = setupFor(extension.slug);
          if (!setup) {
            return;
          }

          try {
            await this.injector.get(setup.provider).load();
          } catch {
            // Молча: карточка покажет расширение неподключённым.
          }
        }),
      );
    } catch {
      this.toasts.error('Не удалось загрузить каталог расширений');
    } finally {
      this.loading.set(false);
    }
  }
}
