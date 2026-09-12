import { Component, input } from '@angular/core';

/**
 * Пульсирующая заглушка на место текста: `<app-skeleton />`.
 * Ширина в пикселях, высота подстраивается под строку (`1em`).
 */
@Component({
  selector: 'app-skeleton',
  template: '',
  host: {
    class:
      'inline-block h-[1em] animate-pulse rounded-sm bg-neutral-200 align-middle motion-reduce:animate-none',
    role: 'presentation',
    '[style.width.px]': 'width()',
  },
})
export class Skeleton {
  readonly width = input(112);
}
