import { Component, computed, input } from '@angular/core';

/**
 * Кружок с инициалами вместо фотографии: `<app-avatar [email]="user()" />`.
 * Фотографий у сотрудников нет, а узнавать себя в углу экрана всё равно нужно.
 */
@Component({
  selector: 'app-avatar',
  template: '{{ initials() }}',
  host: {
    class:
      'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ' +
      'bg-neutral-200 text-xs font-medium text-neutral-700 uppercase select-none',
    '[attr.title]': 'email() || null',
    'aria-hidden': 'true',
  },
})
export class Avatar {
  readonly email = input('');

  /**
   * Первые буквы имени до собачки: «ivan.petrov@shop.kz» — «IP», а
   * «shop@tvoymagazin.kz» — «S». Пусто — рисуем прочерк, а не пустой кружок.
   */
  protected readonly initials = computed(() => {
    const [name = ''] = this.email().split('@');
    const parts = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

    if (!parts.length) {
      return '—';
    }

    return parts
      .slice(0, 2)
      .map((part) => part[0])
      .join('');
  });
}
