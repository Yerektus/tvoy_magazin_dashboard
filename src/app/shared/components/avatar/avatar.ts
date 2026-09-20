import { Component, computed, input } from '@angular/core';

export type AvatarSize = 'sm' | 'md';

/**
 * Кружок с фото или инициалом: `<app-avatar [name]="user().name" />`.
 * Фотографий у сотрудников пока нет — тогда одна буква имени. В меню
 * слева имя часто пустое, там берём буквы из почты, как раньше.
 */
@Component({
  selector: 'app-avatar',
  template: `
    @if (src()) {
      <img [src]="src()" alt="" class="size-full object-cover" />
    } @else {
      {{ initials() }}
    }
  `,
  host: {
    '[class]': 'hostClass()',
    '[attr.title]': 'title() || null',
    'aria-hidden': 'true',
  },
})
export class Avatar {
  readonly email = input('');
  readonly name = input('');
  /** Ссылка на фото. Пусто — рисуем инициал. */
  readonly src = input('');
  readonly size = input<AvatarSize>('md');

  protected readonly title = computed(() => this.name().trim() || this.email() || null);

  protected readonly hostClass = computed(() => {
    const size = this.size() === 'sm' ? 'size-6 text-xs' : 'size-8 text-xs';

    return (
      'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ' +
      `bg-neutral-200 font-medium leading-none text-neutral-700 uppercase select-none ${size}`
    );
  });

  /**
   * Одна буква имени: «Ержан» — «Е». Нет имени — первые буквы почты до
   * собачки: «ivan.petrov@shop.kz» — «IP». Совсем пусто — прочерк, а не
   * пустой кружок.
   */
  protected readonly initials = computed(() => {
    const name = this.name().trim();

    if (name) {
      return name[0] ?? '—';
    }

    const [local = ''] = this.email().split('@');
    const parts = local.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

    if (!parts.length) {
      return '—';
    }

    return parts
      .slice(0, 2)
      .map((part) => part[0])
      .join('');
  });
}
