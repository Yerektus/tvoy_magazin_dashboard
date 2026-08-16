import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  title: string;
  message: string;
  /** Надпись на кнопке подтверждения. */
  confirmLabel?: string;
  /** Действие необратимое или разрушительное — кнопка красная. */
  danger?: boolean;
}

/**
 * Подтверждение действия: `if (!(await this.confirm.ask({…}))) return;`
 *
 * Само окно рисует `<app-confirm-dialog />` в корне приложения.
 */
@Injectable({ providedIn: 'root' })
export class Confirm {
  private readonly current = signal<ConfirmRequest | null>(null);
  private resolver: ((agreed: boolean) => void) | null = null;

  readonly request = this.current.asReadonly();

  ask(request: ConfirmRequest): Promise<boolean> {
    // Второй вопрос поверх первого не задаём — предыдущий считаем отменённым.
    this.resolver?.(false);

    this.current.set(request);
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  answer(agreed: boolean): void {
    this.current.set(null);
    this.resolver?.(agreed);
    this.resolver = null;
  }
}
