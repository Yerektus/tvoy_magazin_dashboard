import { Directive } from '@angular/core';

/** Пункт выпадающего меню: `<button appMenuItem (click)="…">Удалить</button>`. */
@Directive({
  selector: '[appMenuItem]',
  host: {
    type: 'button',
    role: 'menuitem',
    class:
      'flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-neutral-100',
  },
})
export class MenuItem {}
