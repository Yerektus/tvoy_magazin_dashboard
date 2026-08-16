import { Component, ElementRef, effect, inject, input } from '@angular/core';
import { type IconNode, createElement } from 'lucide';

/**
 * Иконка Lucide: `<app-icon [icon]="X" />`, где `X` импортируется из `lucide`.
 * Цвет наследуется от текста (`stroke: currentColor`).
 */
@Component({
  selector: 'app-icon',
  template: '',
  host: { class: 'inline-flex shrink-0' },
})
export class Icon {
  readonly icon = input.required<IconNode>();
  readonly size = input(16);
  readonly strokeWidth = input(2);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    effect(() => {
      const svg = createElement(this.icon(), {
        width: this.size(),
        height: this.size(),
        'stroke-width': this.strokeWidth(),
      });
      svg.setAttribute('aria-hidden', 'true');
      this.host.nativeElement.replaceChildren(svg);
    });
  }
}
